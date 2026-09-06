"""Render the blank traveler on a consistent Letter-page grid."""
from pathlib import Path
import reportlab
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor
from reportlab.lib.utils import ImageReader


def generate(root):
    fonts = Path(reportlab.__file__).parent / 'fonts'
    for name, filename in [('Traveler', 'Vera.ttf'), ('Traveler-Bold', 'VeraBd.ttf')]:
        pdfmetrics.registerFont(TTFont(name, str(fonts / filename)))
    c = canvas.Canvas(str(root / 'public/templates/build-checklist.pdf'), pagesize=(612, 792))
    c.setTitle('ANA Build Traveler - Blank template')
    c.setAuthor('ANA')

    def text(x, y, value, bold=False, size=9, center=False):
        c.setFillColor(HexColor('#25292c'))
        c.setFont('Traveler-Bold' if bold else 'Traveler', size)
        (c.drawCentredString if center else c.drawString)(x, y, value)

    def line(x, y, xx, yy):
        c.setStrokeColor(HexColor('#b8bec3'))
        c.setLineWidth(.5)
        c.line(x, y, xx, yy)

    def box(top, bottom):
        for x in [36, 576]: line(x, top, x, bottom)
        line(36, top, 576, top)
        line(36, bottom, 576, bottom)

    def fields(top, labels, height=38):
        box(top, top-height)
        width = 540 / len(labels)
        for i, label in enumerate(labels):
            x = 36 + i * width
            if i: line(x, top, x, top-height)
            text(x+8, top-14, label)

    logo = ImageReader(str(root / 'public/sop/ana-logo.png'))
    w, h = logo.getSize()
    c.drawImage(logo, 44, 730, width=108, height=108*h/w, mask='auto')
    text(176, 749, 'BUILD TRAVELER', True, 16)
    text(176, 731, 'Blank master template / Draft')

    fields(714, ['Document number', 'Revision', 'Effective date'], 32)
    fields(682, ['Work order', 'Product / model', 'Serial / lot number'], 32)
    fields(650, ['BOM / configuration revision', 'WI / drawing + revision', 'Date / shift'], 32)
    box(618, 574)
    text(44, 604, 'Site / facility - circle or highlight one')
    for x in [216, 396]: line(x, 596, x, 574)
    for x, value in [(126, 'Spartanburg'), (306, 'Cypress'), (486, 'Henderson')]:
        text(x, 582, value, center=True)

    text(36, 554, 'CHECKS AND VERIFICATION', True, 10)
    text(36, 539, 'Circle a result and initial each check. QC initials only where required.')
    text(36, 525, 'Record required readings. Explain FAIL or N/A in the exceptions area.')
    xs = [36, 62, 250, 326, 446, 511, 576]
    top, header, row = 512, 32, 32
    bottom = top-header-6*row
    c.setFillColor(HexColor('#f4f5f5'))
    c.rect(36, top-header, 540, header, fill=1, stroke=0)
    box(top, bottom)
    for x in xs[1:-1]: line(x, top, x, bottom)
    labels = [('No.', ''), ('Check / acceptance criteria', 'Reference + revision'), ('Actual value', 'If required'), ('Result', 'Circle one'), ('Operator', 'Initials'), ('QC', 'Initials')]
    for i, (label, sub) in enumerate(labels):
        if i in (0, 3, 4, 5):
            x = (xs[i]+xs[i+1])/2
            text(x, top-13, label, True, center=True)
            if sub: text(x, top-25, sub, center=True)
        else:
            text(xs[i]+7, top-13, label, True, size=8)
            text(xs[i]+7, top-25, sub, size=8)
    for i in range(7): line(36, top-header-i*row, 576, top-header-i*row)
    for i in range(6):
        y = top-header-i*row-17
        text(49, y, str(i+1), center=True)
        for x, result in [(346, 'PASS'), (386, 'FAIL'), (426, 'N/A')]: text(x, y, result, size=10, center=True)

    text(36, 262, 'EXCEPTIONS AND REINSPECTION', True, 9)
    box(252, 203)
    text(44, 238, 'Circle one:  NONE  /  SEE BELOW', True)
    text(44, 225, 'Check no., NCR / N/A reason, disposition and reinspection initials:')
    line(44, 212, 568, 212)

    text(36, 185, 'COMPLETION AND HANDOFF', True, 9)
    fields(175, ['Operator name / initials', 'QC name / initials'], 27)
    fields(148, ['Signature / date', 'Signature / date'], 30)
    box(118, 94)
    line(216, 118, 216, 94)
    text(44, 102, 'Handoff - circle one')
    text(306, 102, 'HOLD', center=True)
    text(486, 102, 'READY FOR PDI', center=True)
    fields(94, ['Master prepared by / date', 'Master approved by / date'], 33)
    text(36, 49, 'Before issue: pre-fill this template. Attach a signature roster for additional signers.', size=8)
    line(36, 43, 576, 43)
    text(36, 30, 'ANA  |  Draft master - approve before use. Verify current revision.', size=7)
    text(552, 30, '1 of 1', size=7, center=True)
    c.save()
