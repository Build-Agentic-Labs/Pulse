export const LETTER_TEMPLATE_STYLES = `
.wil-preview { height:100%; overflow:auto; background:var(--color-canvas, #eeefed); }
.wil-toolbar { display:flex; align-items:center; justify-content:space-between; gap:24px; max-width:8.5in; margin:0 auto; padding:20px 0; }
.wil-toolbar strong { display:block; font-size:14px; }
.wil-toolbar span { font-size:12px; color:#666; }
.wil-toolbar a { padding:8px 14px; }
.wil-pages { display:grid; justify-content:center; gap:24px; padding:0 24px 32px; min-width:max-content; }
.wil-sheet { box-sizing:border-box; width:8.5in; height:11in; padding:.4in; background:white; color:#202428; font-family:Arial, sans-serif; font-size:9pt; line-height:1.35; display:flex; flex-direction:column; box-shadow:0 3px 18px #00000016; }
.wil-sheet * { box-sizing:border-box; }
.wil-sheet h1, .wil-sheet h2, .wil-sheet h3, .wil-sheet p { margin:0; }
.wil-sheet h2, .wil-sheet h3 { font-size:9pt; font-weight:700; }
.wil-header { display:grid; grid-template-columns:1.1in 1fr 2.35in; min-height:.78in; border:1px solid #737779; }
.wil-logo { display:flex; align-items:center; justify-content:center; padding:9px; }
.wil-logo img { width:100%; height:auto; }
.wil-title { padding:8px 10px; display:flex; flex-direction:column; justify-content:center; border-right:1px solid #737779; }
.wil-label { font-size:6.5pt; letter-spacing:.1em; text-transform:uppercase; color:#62666a; margin-bottom:4px; }
.wil-title h1 { font-size:12pt; font-weight:700; line-height:1.2; }
.wil-fill { border-bottom:1px solid #ccc; height:20px; }
.wil-revision { width:100%; border-collapse:collapse; table-layout:fixed; font-size:7pt; }
.wil-revision th { font-weight:600; height:23px; border-bottom:1px solid #b8babb; }
.wil-revision th, .wil-revision td { text-align:left; padding:4px 6px; border-right:1px solid #b8babb; }
.wil-revision th:first-child { width:15%; }
.wil-revision th:nth-child(2) { width:37%; }
.wil-revision th:last-child, .wil-revision td:last-child { border-right:0; }
.wil-summary { display:grid; grid-template-columns:1.05in 1fr; gap:8px; padding:9px 0; min-height:.5in; border-bottom:1px solid #96999b; }
.wil-summary p { font-size:8.5pt; }
.wil-safety { min-height:.58in; }
.wil-preparation { display:grid; grid-template-columns:minmax(0, 2fr) minmax(0, 1fr); border-bottom:1px solid #737779; min-height:1.27in; }
.wil-preparation section { padding:8px 10px 8px 0; min-width:0; }
.wil-preparation section:first-child { border-right:1px solid #96999b; }
.wil-preparation section + section { padding-left:12px; padding-right:0; }
.wil-preparation h2 { margin-bottom:5px; }
.wil-bom { width:100%; border-collapse:collapse; table-layout:fixed; font-size:7.5pt; }
.wil-bom th { text-align:left; color:#62666a; font-weight:400; font-size:6.5pt; }
.wil-bom th:first-child { width:31%; }
.wil-bom th:last-child { width:9%; }
.wil-bom td, .wil-bom th { border-bottom:1px solid #e0e1e2; padding:2px 3px 2px 0; height:17px; }
.wil-bom td:last-child, .wil-bom th:last-child { text-align:right; }
.wil-preparation ul { margin:0; padding:0; list-style:none; font-size:8.5pt; }
.wil-preparation li { min-height:19px; border-bottom:1px solid #e0e1e2; padding:2px 0; }
.wil-steps { flex:1; min-height:0; display:grid; grid-template-rows:1fr 1fr; }
.wil-step { display:grid; grid-template-columns:minmax(0, 2fr) minmax(0, 1fr); border-bottom:1px solid #96999b; min-height:0; }
.wil-image { display:flex; justify-content:center; align-items:center; color:#8a8e91; font-size:8pt; letter-spacing:.025em; border-right:1px solid #96999b; }
.wil-step-body { padding:12px; display:flex; flex-direction:column; min-width:0; }
.wil-step-heading { display:flex; align-items:center; gap:9px; }
.wil-number { width:25px; height:25px; display:flex; align-items:center; justify-content:center; border:1px solid #737779; font-size:11pt; font-weight:700; flex:none; }
.wil-instructions { flex:1; padding:12px 0; white-space:pre-wrap; font-size:10pt; line-height:1.5; }
.wil-tools { border-top:1px solid #c3c5c6; min-height:.52in; padding-top:7px; }
.wil-tools h3 { font-size:8pt; margin-bottom:4px; }
.wil-tools p { font-size:8.5pt; }
.wil-footer { flex:none; padding-top:8px; }
.wil-footer > div { display:flex; gap:20px; align-items:center; font-size:7pt; }
.wil-footer strong { flex:1; font-weight:500; }
.wil-footer p { font-size:6pt; letter-spacing:.06em; color:#777; margin-top:5px; }
@media print {
 @page { size:letter portrait; margin:0; }
 html, body { height:auto!important; overflow:visible!important; margin:0!important; }
 body { visibility:hidden; }
 .wil-preview { position:absolute; inset:0; height:auto!important; overflow:visible!important; background:white; }
 .wil-pages, .wil-sheet, .wil-sheet * { visibility:visible; }
 .wil-toolbar { display:none; }
 .wil-pages { display:block; min-width:0; padding:0; margin:0; }
 .wil-sheet { margin:0; box-shadow:none; break-after:page; page-break-after:always; }
 .wil-sheet:last-child { break-after:auto; page-break-after:auto; }
}
`;
