import PizZip from "pizzip";

import { calculateResidualRpn, calculateRowRpn, type PfmeaDocument, type PfmeaRow } from "./pfmea";

const EXPORT_COLUMNS = [
  "Procedure Task",
  "Process Step",
  "Potential Failure Mode",
  "Potential Effect",
  "Severity",
  "Potential Cause",
  "Occurrence",
  "Current Process Controls",
  "Detection",
  "Detection Activity",
  "RPN",
  "Recommended Actions",
  "Owner",
  "Target Date",
  "Actions Taken",
  "Result Occurrence",
  "Result Detection",
  "Residual RPN",
] as const;

function xml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function inlineCell(reference: string, value: unknown, style = 1) {
  return `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
}

function numberCell(reference: string, value: number | undefined, style = 4) {
  return value == null ? `<c r="${reference}" s="${style}"/>` : `<c r="${reference}" s="${style}"><v>${value}</v></c>`;
}

function formulaCell(reference: string, formula: string) {
  return `<c r="${reference}" s="4"><f>${xml(formula)}</f></c>`;
}

function proposalText(row: PfmeaRow) {
  const proposals = row.controlProposals.map((proposal) => `[${proposal.target} · ${proposal.status}] ${proposal.title}`);
  return [row.recommendedActions, ...proposals].filter(Boolean).join("\n");
}

function worksheetXml(document: PfmeaDocument, productName: string, includeLogo: boolean) {
  const rows = document.rows.map((row, index) => {
    const sheetRow = index + 6;
    return `<row r="${sheetRow}" ht="48" customHeight="1">
      ${inlineCell(`A${sheetRow}`, `${row.taskCodeSnapshot ?? ""}${row.taskNameSnapshot ? ` · ${row.taskNameSnapshot}` : ""}`)}
      ${inlineCell(`B${sheetRow}`, row.processStepSnapshot ?? "Task level")}
      ${inlineCell(`C${sheetRow}`, row.failureMode)}
      ${inlineCell(`D${sheetRow}`, row.effect)}
      ${numberCell(`E${sheetRow}`, row.severity)}
      ${inlineCell(`F${sheetRow}`, row.cause)}
      ${numberCell(`G${sheetRow}`, row.occurrence)}
      ${inlineCell(`H${sheetRow}`, row.currentControls)}
      ${numberCell(`I${sheetRow}`, row.detection)}
      ${inlineCell(`J${sheetRow}`, row.detectionActivity)}
      ${formulaCell(`K${sheetRow}`, `IF(COUNT(E${sheetRow},G${sheetRow},I${sheetRow})=3,E${sheetRow}*G${sheetRow}*I${sheetRow},"")`)}
      ${inlineCell(`L${sheetRow}`, proposalText(row))}
      ${inlineCell(`M${sheetRow}`, row.actionOwner)}
      ${inlineCell(`N${sheetRow}`, row.targetDate ?? "")}
      ${inlineCell(`O${sheetRow}`, row.actionsTaken)}
      ${numberCell(`P${sheetRow}`, row.resultOccurrence)}
      ${numberCell(`Q${sheetRow}`, row.resultDetection)}
      ${formulaCell(`R${sheetRow}`, `IF(COUNT(E${sheetRow},P${sheetRow},Q${sheetRow})=3,E${sheetRow}*P${sheetRow}*Q${sheetRow},"")`)}
    </row>`;
  }).join("");
  const headerCells = EXPORT_COLUMNS.map((column, index) => inlineCell(`${String.fromCharCode(65 + index)}5`, column, 3)).join("");
  const drawing = includeLogo ? '<drawing r:id="rId1"/>' : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="5" xSplit="2" topLeftCell="C6" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>
  <cols>
    <col min="1" max="2" width="25" customWidth="1"/>
    <col min="3" max="4" width="30" customWidth="1"/>
    <col min="5" max="5" width="10" customWidth="1"/>
    <col min="6" max="6" width="30" customWidth="1"/>
    <col min="7" max="7" width="11" customWidth="1"/>
    <col min="8" max="8" width="30" customWidth="1"/>
    <col min="9" max="9" width="10" customWidth="1"/>
    <col min="10" max="10" width="26" customWidth="1"/>
    <col min="11" max="11" width="12" customWidth="1"/>
    <col min="12" max="12" width="32" customWidth="1"/>
    <col min="13" max="15" width="20" customWidth="1"/>
    <col min="16" max="18" width="14" customWidth="1"/>
  </cols>
  <sheetData>
    <row r="1" ht="34" customHeight="1">${includeLogo ? "" : inlineCell("A1", "ANA", 2)}${inlineCell("B1", `${productName} PFMEA`, 2)}</row>
    <row r="2">${inlineCell("B2", "Process Failure Mode and Effects Analysis", 5)}${inlineCell("G2", document.documentNumber, 5)}${inlineCell("I2", `Rev ${document.revision}`, 5)}${inlineCell("K2", document.originalDate, 5)}</row>
    <row r="3">${inlineCell("B3", `Model: ${document.model}`, 5)}${inlineCell("F3", `Responsibility: ${document.owner}`, 5)}${inlineCell("K3", `Scenario: ${document.sourceScenarioName}`, 5)}</row>
    <row r="4"/>
    <row r="5" ht="30" customHeight="1">${headerCells}</row>
    ${rows}
  </sheetData>
  <mergeCells count="5"><mergeCell ref="B1:F1"/><mergeCell ref="B2:F2"/><mergeCell ref="G2:H2"/><mergeCell ref="B3:E3"/><mergeCell ref="F3:J3"/></mergeCells>
  <autoFilter ref="A5:R${Math.max(5, document.rows.length + 5)}"/>
  <conditionalFormatting sqref="K6:K${Math.max(6, document.rows.length + 5)} R6:R${Math.max(6, document.rows.length + 5)}"><cfRule type="cellIs" dxfId="0" priority="1" operator="greaterThanOrEqual"><formula>${document.settings.highRpnThreshold}</formula></cfRule></conditionalFormatting>
  <pageMargins left="0.2" right="0.2" top="0.3" bottom="0.3" header="0.1" footer="0.1"/>
  <pageSetup orientation="landscape" paperSize="8" fitToWidth="1" fitToHeight="0"/>
  ${drawing}
</worksheet>`;
}

function stylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="4">
    <font><sz val="10"/><name val="Arial"/></font>
    <font><b/><sz val="16"/><name val="Arial"/><color rgb="FF1F2428"/></font>
    <font><b/><sz val="10"/><name val="Arial"/><color rgb="FF1F2428"/></font>
    <font><b/><sz val="9"/><name val="Arial"/><color rgb="FF1F2428"/></font>
  </fonts>
  <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF3F3F1"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="2"><border/><border><left style="thin"><color rgb="FFD8D8D5"/></left><right style="thin"><color rgb="FFD8D8D5"/></right><top style="thin"><color rgb="FFD8D8D5"/></top><bottom style="thin"><color rgb="FFD8D8D5"/></bottom></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="6">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
  </cellXfs>
  <dxfs count="1"><dxf><font><color rgb="FFD71921"/><b/></font><fill><patternFill patternType="solid"><fgColor rgb="FFFFE8E8"/><bgColor indexed="64"/></patternFill></fill></dxf></dxfs>
</styleSheet>`;
}

function drawingXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <xdr:oneCellAnchor>
    <xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
    <xdr:ext cx="1050000" cy="300000"/>
    <xdr:pic><xdr:nvPicPr><xdr:cNvPr id="1" name="ANA logo"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic>
    <xdr:clientData/>
  </xdr:oneCellAnchor>
</xdr:wsDr>`;
}

export async function buildPfmeaXlsx(document: PfmeaDocument, productName: string, logoBytes?: ArrayBuffer) {
  const includeLogo = Boolean(logoBytes);
  const zip = new PizZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${includeLogo ? '<Default Extension="png" ContentType="image/png"/>' : ""}<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${includeLogo ? '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' : ""}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`);
  zip.file("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><calcPr calcId="191029" fullCalcOnLoad="1" forceFullCalc="1"/><sheets><sheet name="PFMEA" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.file("xl/styles.xml", stylesXml());
  zip.file("xl/worksheets/sheet1.xml", worksheetXml(document, productName, includeLogo));
  zip.file("docProps/core.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(`${productName} PFMEA`)}</dc:title><dc:creator>ANA Pulse</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${xml(document.createdAt)}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${xml(document.updatedAt)}</dcterms:modified></cp:coreProperties>`);
  zip.file("docProps/app.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>ANA Pulse</Application></Properties>`);
  if (logoBytes) {
    zip.file("xl/media/ana-logo.png", logoBytes, { binary: true });
    zip.file("xl/drawings/drawing1.xml", drawingXml());
    zip.file("xl/drawings/_rels/drawing1.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/ana-logo.png"/></Relationships>`);
    zip.file("xl/worksheets/_rels/sheet1.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>`);
  }
  const bytes = zip.generate({ type: "uint8array", compression: "DEFLATE" });
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

function printRows(document: PfmeaDocument) {
  return document.rows.map((row) => `<tr>
    <td>${xml(row.taskCodeSnapshot)}<br><span>${xml(row.taskNameSnapshot)}</span></td>
    <td>${xml(row.processStepSnapshot)}</td>
    <td>${xml(row.failureMode)}</td><td>${xml(row.effect)}</td><td class="score">${xml(row.severity ?? "")}</td>
    <td>${xml(row.cause)}</td><td class="score">${xml(row.occurrence ?? "")}</td><td>${xml(row.currentControls)}</td>
    <td class="score">${xml(row.detection ?? "")}</td><td>${xml(row.detectionActivity)}</td><td class="score">${xml(calculateRowRpn(row) ?? "")}</td>
    <td>${xml(proposalText(row))}</td><td>${xml(row.actionOwner)}</td><td>${xml(row.targetDate)}</td><td>${xml(row.actionsTaken)}</td>
    <td class="score">${xml(row.resultOccurrence ?? "")}</td><td class="score">${xml(row.resultDetection ?? "")}</td><td class="score">${xml(calculateResidualRpn(row) ?? "")}</td>
  </tr>`).join("");
}

export function buildPfmeaPrintHtml(document: PfmeaDocument, productName: string, logoUrl = "/sop/ana-logo.png") {
  const headings = EXPORT_COLUMNS.map((column) => `<th>${xml(column)}</th>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${xml(productName)} PFMEA</title><style>
    @page{size:A3 landscape;margin:9mm}*{box-sizing:border-box}body{margin:0;color:#1f2428;font-family:Arial,sans-serif;font-size:7px}
    header{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-bottom:8px;border-bottom:1px solid #cfcfcb;padding-bottom:7px}header img{width:105px;height:30px;object-fit:contain}header .title{flex:1}h1{margin:0;font-size:16px}header p{margin:2px 0 0;color:#5d6267}.meta{display:grid;grid-template-columns:repeat(3,auto);gap:4px 16px}.meta span{color:#6b7075;text-transform:uppercase;font-size:6px}.meta strong{display:block;margin-top:1px;font-size:7px}
    table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{border:1px solid #d8d8d5;padding:3px;vertical-align:top;overflow-wrap:anywhere;white-space:pre-wrap}th{background:#f3f3f1;font-size:6px;text-align:left;text-transform:uppercase}td{height:28px}td span{color:#6b7075}.score{text-align:center;font-weight:bold}th:nth-child(5),th:nth-child(7),th:nth-child(9),th:nth-child(11),th:nth-child(16),th:nth-child(17),th:nth-child(18){width:3%}th:nth-child(1),th:nth-child(2){width:7%}th:nth-child(3),th:nth-child(4),th:nth-child(6),th:nth-child(8),th:nth-child(10),th:nth-child(12),th:nth-child(15){width:8%}
  </style></head><body><header><img src="${xml(logoUrl)}" alt="ANA"><div class="title"><h1>${xml(productName)} PFMEA</h1><p>Process Failure Mode and Effects Analysis</p></div><div class="meta"><div><span>Document</span><strong>${xml(document.documentNumber)}</strong></div><div><span>Revision</span><strong>${xml(document.revision)}</strong></div><div><span>Date</span><strong>${xml(document.originalDate)}</strong></div><div><span>Model</span><strong>${xml(document.model)}</strong></div><div><span>Responsibility</span><strong>${xml(document.owner)}</strong></div><div><span>Scenario</span><strong>${xml(document.sourceScenarioName)}</strong></div></div></header><table><thead><tr>${headings}</tr></thead><tbody>${printRows(document)}</tbody></table></body></html>`;
}
