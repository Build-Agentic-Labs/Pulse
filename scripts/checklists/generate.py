"""Generate blank ANA US Letter checklist master templates (reportlab)."""
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib import colors
from reportlab.lib.utils import ImageReader
ROOT=Path(__file__).resolve().parents[2]
INK=colors.HexColor('#25292c'); GRAY=colors.HexColor('#6b7176'); LINE=colors.HexColor('#b8bec3')
for kind,title,code in [('pdi','PRE-DELIVERY INSPECTION','PDI')]:
 c=canvas.Canvas(str(ROOT/'public/templates'/f'{kind}-checklist.pdf'),pagesize=(612,792))
 c.setTitle(f'ANA {title.title()} - Blank template');c.setAuthor('ANA')
 def text(x,y,t,size=8,bold=False):
  c.setFillColor(INK);c.setFont('Helvetica-Bold' if bold else 'Helvetica',size);c.drawString(x,y,t)
 def centered(x,y,t,size=8,bold=False):
  c.setFillColor(INK);c.setFont('Helvetica-Bold' if bold else 'Helvetica',size);c.drawCentredString(x,y,t)
 def line(x,y,x2,y2):
  c.setStrokeColor(LINE);c.setLineWidth(.5);c.line(x,y,x2,y2)
 def fields(y, labels):
  w=540/len(labels)
  for i,label in enumerate(labels):
   x=36+i*w;text(x+4,y-11,label,7);line(x+4,y-32,x+w-4,y-32)
  return y-42
 logo=ImageReader(str(ROOT/'public/sop/ana-logo.png'));lw,lh=logo.getSize()
 c.drawImage(logo,36,724,width=112,height=112*lh/lw,mask='auto',preserveAspectRatio=True)
 text(170,748,title,16,True);text(170,731,'BLANK MASTER TEMPLATE  /  DRAFT',8);line(36,716,576,716)
 if kind=='build':
  y=fields(708,['Document number (pre-filled)','Revision (pre-filled)','Effective date (pre-filled)'])
  text(40,y-10,'SITE - CIRCLE OR HIGHLIGHT ONE:',7,True)
  for x,site in zip([276,396,516],['Spartanburg','Cypress','Henderson']): centered(x,y-10,site,9)
  y-=22
 else:
  y=fields(708,['Document number','Revision','Effective date','Site / facility'])
 y=fields(y,['Record / work order number','Product / model','Unit serial / lot number'])
 y=fields(y,['Configuration / BOM revision','WI / drawing / test reference and revision','Date / shift'])
 text(36,y-4,'CHECKS AND VERIFICATION',9,True)
 text(36,y-18,'Before issue: pre-fill unit details, checks, limits and references. Operator: circle / highlight one result per row.' if kind=='build' else 'Enter the check, acceptance criteria and reference. Record actual values where required.',7)
 text(36,y-29,'Initial completed checks. QC initials only where required. Write only required readings or exceptions; explain N/A.' if kind=='build' else 'Result: P = Pass, F = Fail, N/A = Not applicable (explain). Operator and QC sign where required.',7)
 top=y-40; widths=[22,186,74,108,75,75] if kind=='build' else [25,170,92,38,106,109];xs=[36]
 for w in widths:xs.append(xs[-1]+w)
 headers=[['No.'],['Check / acceptance criteria','Reference / revision'],['Actual value /','evidence reference'],['Result'],['Operator signature','Name / ID and date'],['QC signature','Name / ID and date']]
 if kind=='build':
  headers=[['No.'],['Check / acceptance criteria','Reference / revision (pre-filled)'],['Actual value','Only if required'],['CIRCLE / HIGHLIGHT'],['Operator','Initials'],['QC initials','If required']]
 row_height=28 if kind=='build' else 30
 bottom=top-28-8*row_height
 for x in xs:line(x,top,x,bottom)
 for i,h in enumerate(headers):
  for j,t in enumerate(h):text(xs[i]+4,top-11-j*9,t,6.7,True)
 line(36,top,576,top);line(36,top-28,576,top-28)
 for i in range(8):
  row_y=top-28-i*row_height
  centered((xs[0]+xs[1])/2,row_y-17,str(i+1),7)
  if kind=='build':
   for j,result in enumerate(['PASS','FAIL','N/A']): centered(xs[3]+18+j*36,row_y-17,result,7,True)
  line(36,top-28-(i+1)*row_height,576,top-28-(i+1)*row_height)
 y=bottom-18;text(36,y,'EXCEPTIONS / NCR / REWORK / REINSPECTION',8,True)
 text(36,y-12,'Circle:  NONE  /  SEE BELOW     If needed: check no., NCR / N/A reason, disposition and reinspection initials.' if kind=='build' else 'Include check number, disposition / approval, corrective action and reinspection sign-off.',6.8)
 line(36,y-31,576,y-31);line(36,y-48,576,y-48)
 y-=65;text(36,y,'COMPLETION AND AUTHORIZATION',8,True)
 y=fields(y-6,['Operator name / initials / signature / date' if kind=='build' else 'Inspector signature and date','QC name / initials / signature / date' if kind=='build' else 'QC verification signature and date'])
 if kind=='build':
  text(40,y-11,'HANDOFF STATUS - CIRCLE ONE:',7,True)
  centered(330,y-11,'HOLD',8,True);centered(474,y-11,'READY FOR PDI',8,True)
  text(40,y-31,'Accepted for PDI - initials / date:',7);line(143,y-33,298,y-33)
  text(310,y-31,'Additional signers: attach signature roster.',7)
 else:
  y=fields(y,['Release authority - signature and date','Final status / hold or concession reference'])
 line(36,89,576,89)
 for x,label in [(40,'Prepared by / date:'),(310,'Approved by / date:')]:
  text(x,77,label,6.7);line(x+85,75,x+262,75)
 for x,label in [(40,'Revision / change reference:'),(310,'Master / retention policy:')]:
  text(x,64,label,6.7);line(x+100,62,x+262,62)
 line(36,45,576,45);text(36,32,f'ANA  |  {code} blank template  |  Approve before use. Verify current revision before printing.',6.5);text(532,32,'Page 1 of 1',6.5)
 c.save()

from build_traveler import generate
generate(ROOT)
