"""Document endpoints: types, generate, list, get, update, delete, regenerate, sign, pdf."""
import base64

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from models.document import Document, User, get_db, now
from routes.auth import get_current_user
from services import document_service as ds
from services.ai_service import AIError, generate_draft
from services.pdf_service import build_pdf

router = APIRouter(prefix="/api/documents", tags=["documents"])


class GenerateIn(BaseModel):
    document_type: str
    requirements: dict


class UpdateIn(BaseModel):
    content: str = Field(max_length=50000)


class SignIn(BaseModel):
    signature: str = Field(max_length=400000)


def _out(d: Document, full: bool = True) -> dict:
    data = {
        "id": d.id,
        "title": d.title,
        "document_type": d.document_type,
        "type_label": ds.DOCUMENT_TYPES.get(d.document_type, {}).get("label", d.document_type),
        "status": d.status,
        "created_at": d.created_at.isoformat(),
        "updated_at": d.updated_at.isoformat(),
    }
    if full:
        data["content"] = d.content
        data["signature"] = d.signature
        data["signed_at"] = d.signed_at.isoformat() if d.signed_at else None
    return data


def _owned(db: Session, user: User, doc_id: str) -> Document:
    doc = db.get(Document, doc_id)
    if not doc or doc.owner_id != user.id:  # 404 (not 403) so IDs are not revealed
        raise HTTPException(404, "Document not found.")
    return doc


def _draft(doc_type: str, requirements: dict) -> str:
    system, user_prompt = ds.build_prompts(doc_type, requirements)
    try:
        return generate_draft(system, user_prompt)
    except AIError as err:
        raise HTTPException(err.status, str(err))


def _unsign(doc: Document):
    doc.signature, doc.signed_at, doc.status = None, None, "draft"


@router.get("/types")
def types():
    return ds.public_types()


@router.get("")
def list_documents(q: str = "", user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    query = db.query(Document).filter(Document.owner_id == user.id)
    if q.strip():
        query = query.filter(Document.title.ilike(f"%{q.strip()}%"))
    return [_out(d, full=False) for d in query.order_by(Document.updated_at.desc())]


@router.post("/generate", status_code=201)
def generate(data: GenerateIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        requirements = ds.clean_requirements(data.document_type, data.requirements)
    except ValueError as err:
        raise HTTPException(422, str(err))
    content = _draft(data.document_type, requirements)
    doc = Document(
        owner_id=user.id,
        document_type=data.document_type,
        title=ds.DOCUMENT_TYPES[data.document_type]["label"],
        requirements=requirements,
        content=content,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return _out(doc)


@router.get("/{doc_id}")
def get_document(doc_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _out(_owned(db, user, doc_id))


@router.put("/{doc_id}")
def update_document(doc_id: str, data: UpdateIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    doc = _owned(db, user, doc_id)
    if data.content != doc.content:
        doc.content = data.content
        _unsign(doc)  # edited text invalidates an earlier signature
    db.commit()
    db.refresh(doc)
    return _out(doc)


@router.delete("/{doc_id}", status_code=204)
def delete_document(doc_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.delete(_owned(db, user, doc_id))
    db.commit()
    return Response(status_code=204)


@router.post("/{doc_id}/regenerate")
def regenerate(doc_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    doc = _owned(db, user, doc_id)
    doc.content = _draft(doc.document_type, doc.requirements)
    _unsign(doc)
    db.commit()
    db.refresh(doc)
    return _out(doc)


@router.post("/{doc_id}/sign")
def sign(doc_id: str, data: SignIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    doc = _owned(db, user, doc_id)
    prefix = "data:image/png;base64,"
    if not data.signature.startswith(prefix):
        raise HTTPException(422, "Signature must be a PNG image.")
    try:
        base64.b64decode(data.signature[len(prefix):], validate=True)
    except ValueError:
        raise HTTPException(422, "Signature data is invalid.")
    doc.signature, doc.signed_at, doc.status = data.signature, now(), "completed"
    db.commit()
    db.refresh(doc)
    return _out(doc)


@router.get("/{doc_id}/pdf")
def download_pdf(doc_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    doc = _owned(db, user, doc_id)
    try:
        pdf_bytes = build_pdf(doc.title, doc.content, user.full_name, doc.signature, doc.signed_at)
    except Exception:
        raise HTTPException(500, "Could not generate the PDF. Please try again.")
    return Response(pdf_bytes, media_type="application/pdf")