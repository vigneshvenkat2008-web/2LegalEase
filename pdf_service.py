"""Builds the PDF. All text is escaped because ReportLab Paragraphs parse inline markup."""
import base64
import io
from datetime import datetime
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import HRFlowable, Image, Paragraph, SimpleDocTemplate, Spacer

VIOLET = colors.HexColor("#2B124C")
GOLD = colors.HexColor("#D4AF37")


def _footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(colors.grey)
    canvas.drawString(20 * mm, 12 * mm, "LegalEase - AI-generated draft. Not legal advice; consult a qualified legal professional.")
    canvas.drawRightString(A4[0] - 20 * mm, 12 * mm, f"Page {doc.page}")
    canvas.restoreState()


def build_pdf(title, content, signer_name, signature_url, signed_at) -> bytes:
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, title=title, leftMargin=20 * mm, rightMargin=20 * mm,
                            topMargin=20 * mm, bottomMargin=22 * mm)
    styles = getSampleStyleSheet()
    brand = ParagraphStyle("brand", parent=styles["Normal"], textColor=GOLD, fontName="Helvetica-Bold", fontSize=10)
    heading = ParagraphStyle("heading", parent=styles["Title"], textColor=VIOLET, fontName="Helvetica-Bold", fontSize=20)
    body = ParagraphStyle("body", parent=styles["BodyText"], fontSize=10.5, leading=15)

    story = [Paragraph("LEGALEASE", brand), Paragraph(escape(title), heading),
             HRFlowable(color=GOLD, thickness=1.5), Spacer(1, 6 * mm)]
    for block in content.split("\n\n"):
        if block.strip():
            story += [Paragraph(escape(block.strip()).replace("\n", "<br/>"), body), Spacer(1, 3 * mm)]

    story.append(Spacer(1, 10 * mm))
    if signature_url:
        raw = base64.b64decode(signature_url.split(",", 1)[1])
        story.append(Image(io.BytesIO(raw), width=60 * mm, height=22.5 * mm, hAlign="LEFT"))  # canvas is 400x150
        date_text = signed_at.strftime("%d %b %Y") if signed_at else datetime.now().strftime("%d %b %Y")
        story.append(Paragraph(f"Signed by {escape(signer_name)} on {date_text} (demonstration e-signature)", body))
    else:
        story.append(Paragraph("Signature: ______________________ &nbsp;&nbsp; Date: ______________", body))

    doc.build(story, onFirstPage=_footer, onLaterPages=_footer)
    return buffer.getvalue()