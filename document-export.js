const encoder = new TextEncoder();
const xml = value => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));

function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

// Uncompressed ZIP is part of the OOXML specification and needs no runtime library.
function zip(files) {
    const parts = [], directory = [];
    let offset = 0, directorySize = 0;
    for (const [filename, content] of Object.entries(files)) {
        const name = encoder.encode(filename), data = encoder.encode(content), crc = crc32(data);
        const local = new Uint8Array(30 + name.length), view = new DataView(local.buffer);
        view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true);
        view.setUint16(6, 0x800, true); view.setUint16(12, 33, true);
        view.setUint32(14, crc, true); view.setUint32(18, data.length, true); view.setUint32(22, data.length, true);
        view.setUint16(26, name.length, true); local.set(name, 30);
        const central = new Uint8Array(46 + name.length), cv = new DataView(central.buffer);
        cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
        cv.setUint16(8, 0x800, true); cv.setUint16(14, 33, true); cv.setUint32(16, crc, true);
        cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
        cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true); central.set(name, 46);
        parts.push(local, data); directory.push(central);
        offset += local.length + data.length; directorySize += central.length;
    }
    const end = new Uint8Array(22), ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, directory.length, true); ev.setUint16(10, directory.length, true);
    ev.setUint32(12, directorySize, true); ev.setUint32(16, offset, true);
    return new Blob([...parts, ...directory, end], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

export function paragraphs(rows) {
    const output = [];
    for (const row of rows) {
        if (!output.length || row.newParagraph) output.push(String(row.target ?? ''));
        else output[output.length - 1] += ' ' + String(row.target ?? '');
    }
    return output;
}

export function createDocx(rows, { sourceLang = 'Source', targetLang = 'Korean', fontSize = 18, layout = 'translation' } = {}) {
    const language = targetLang === 'Korean' ? 'ko-KR' : targetLang === 'English' ? 'en-US' : 'und';
    const size = Math.round(Math.min(32, Math.max(12, fontSize)) * 1.5);
    const paragraph = text => `<w:p><w:pPr><w:spacing w:after="160" w:line="360" w:lineRule="auto"/><w:wordWrap w:val="0"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Malgun Gothic"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/><w:lang w:val="${language}" w:eastAsia="${language}"/></w:rPr>${String(text ?? '').split('\n').map(line => `<w:t xml:space="preserve">${xml(line)}</w:t>`).join('<w:br/>')}</w:r></w:p>`;
    let content = paragraphs(rows).map(paragraph).join('');
    if (layout === 'aligned') {
        const threeWay = rows.some(row => row.originalTranslation !== undefined);
        const width = threeWay ? 3120 : 4680;
        const cell = text => `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr>${paragraph(text)}</w:tc>`;
        const heading = [sourceLang, ...(threeWay ? ['Original translation'] : []), targetLang];
        const cells = row => [row.source, ...(threeWay ? [row.originalTranslation || ''] : []), row.target];
        content = `<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblBorders>${['top','left','bottom','right','insideH','insideV'].map(edge => `<w:${edge} w:val="single" w:sz="4" w:color="C5D1D7"/>`).join('')}</w:tblBorders></w:tblPr><w:tblGrid>${heading.map(() => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid><w:tr><w:trPr><w:tblHeader/></w:trPr>${heading.map(cell).join('')}</w:tr>${rows.map(row => `<w:tr>${cells(row).map(cell).join('')}</w:tr>`).join('')}</w:tbl>`;
    }
    return zip({
        '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
        '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
        'word/document.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${content}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`
    });
}

export function downloadDocx(rows, options) {
    const url = URL.createObjectURL(createDocx(rows, options));
    const link = document.createElement('a');
    link.href = url; link.download = 'translation.docx';
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function printPdf(rows, { targetLang = 'Korean', sourceLang = 'English', fontSize = 18, layout = 'translation' } = {}) {
    const win = window.open('', '_blank');
    if (!win) throw new Error('Allow pop-ups to open PDF export.');
    const threeWay = rows.some(row => row.originalTranslation !== undefined);
    const columns = [sourceLang, ...(threeWay ? ['Original translation'] : []), targetLang];
    const html = layout === 'aligned'
        ? `<table><thead><tr>${columns.map(value => `<th>${xml(value)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${[row.source, ...(threeWay ? [row.originalTranslation || ''] : []), row.target].map(value => `<td>${xml(value)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
        : paragraphs(rows).map(text => `<p>${xml(text)}</p>`).join('');
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Translation</title><style>@page{size:A4;margin:20mm}body{font-family:Arial,"Malgun Gothic",sans-serif;color:#111;background:#fff;font-size:${Math.min(32,Math.max(12,fontSize)) * .75}pt;line-height:1.6}p{white-space:pre-wrap;word-break:keep-all;overflow-wrap:normal;margin:0 0 1em}table{width:100%;border-collapse:collapse;table-layout:fixed}thead{display:table-header-group}td,th{padding:8px;text-align:left;vertical-align:top;border:1px solid #bbb;white-space:pre-wrap;word-break:keep-all;overflow-wrap:normal}th{font-size:10pt}h1{font-size:12pt;margin:0 0 20px}</style></head><body><h1>${xml(sourceLang)} → ${xml(targetLang)}</h1>${html}</body></html>`);
    win.addEventListener('load', () => { win.focus(); win.print(); }, { once: true });
    win.document.close();
}
