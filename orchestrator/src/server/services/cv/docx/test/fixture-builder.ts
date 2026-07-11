import { deflateSync } from "node:zlib";
import AdmZip from "adm-zip";

/**
 * In-memory docx builder for the W2 test suite. TS analog of the W1
 * spike's build-fixtures.py (whose output passed XML validation,
 * LibreOffice conversion, and opened in Word — the sanity provenance
 * for the shared XML shapes) plus the pathological cases only tests
 * need: rsid-fragmented runs, AlternateContent duplication, tracked
 * changes, external fields, DOCTYPE, marker collisions, traversal zips.
 * Lives under test/ so the .dockerignore `**` + `/test/` glob keeps it
 * out of the production image; tests run via the src bind-mount.
 */

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

export const NSDECLS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" ' +
  'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" ' +
  'xmlns:v="urn:schemas-microsoft-com:vml" ' +
  'xmlns:o="urn:schemas-microsoft-com:office:office" ' +
  'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"';

const ROOT_RELS =
  XML_DECL +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  "</Relationships>";

export function contentTypes(extraOverrides = "", png = false): string {
  return (
    XML_DECL +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    (png ? '<Default Extension="png" ContentType="image/png"/>' : "") +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    extraOverrides +
    "</Types>"
  );
}

export interface RunOpts {
  bold?: boolean;
  rsid?: string;
  rPrRaw?: string;
  preserve?: boolean;
}

export function run(text: string, opts: RunOpts = {}): string {
  const rPr = opts.rPrRaw ?? (opts.bold ? "<w:rPr><w:b/></w:rPr>" : "");
  const rsid = opts.rsid ? ` w:rsidR="${opts.rsid}"` : "";
  const space = (opts.preserve ?? true) ? ' xml:space="preserve"' : "";
  return `<w:r${rsid}>${rPr}<w:t${space}>${text}</w:t></w:r>`;
}

export function p(content: string, rsid?: string): string {
  const attr = rsid ? ` w:rsidR="${rsid}"` : "";
  return `<w:p${attr}>${content}</w:p>`;
}

export function para(text: string, opts: RunOpts = {}): string {
  return p(run(text, opts));
}

export const SECTPR =
  "<w:sectPr>" +
  '<w:pgSz w:w="11906" w:h="16838"/>' +
  '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/>' +
  "</w:sectPr>";

export function documentXml(body: string, sectPr: string = SECTPR): string {
  return `${XML_DECL}<w:document ${NSDECLS}><w:body>${body}${sectPr}</w:body></w:document>`;
}

export function buildDocx(parts: Record<string, string | Buffer>): Uint8Array {
  const zip = new AdmZip();
  for (const [name, data] of Object.entries(parts)) {
    zip.addFile(
      name,
      typeof data === "string" ? Buffer.from(data, "utf8") : data,
    );
  }
  return new Uint8Array(zip.toBuffer());
}

export function docxWithBody(body: string): Uint8Array {
  return buildDocx({
    "[Content_Types].xml": contentTypes(),
    "_rels/.rels": ROOT_RELS,
    "word/document.xml": documentXml(body),
  });
}

// ---------------------------------------------------------------- canned docs

export function simpleDoc(): Uint8Array {
  return docxWithBody(
    para("Jane Q. Applicant", { bold: true }) +
      para("Vienna, Austria · jane@example.com") +
      para(
        "Led migration of the rendering fleet to a queue-based architecture.",
      ) +
      para(
        "Cut PDF generation latency by 60% through template precompilation.",
      ),
  );
}

/** One phrase fractured across four runs: identical formatting modulo
 * rsid stamps, with proofErr bookends — Word's classic fragmentation. */
export function fragmentedRunsDoc(): Uint8Array {
  const body = p(
    '<w:proofErr w:type="spellStart"/>' +
      run("Led migr", { rsid: "00AA1111" }) +
      run("ation of the ", { rsid: "00BB2222" }) +
      '<w:proofErr w:type="spellEnd"/>' +
      run("rendering fleet", { rsid: "00CC3333" }) +
      run(".", { rsid: "00DD4444" }),
    "00AA1111",
  );
  return docxWithBody(body + para("Second paragraph."));
}

/** Adjacent runs with genuinely different rPr — must NOT merge. */
export function differingRPrDoc(): Uint8Array {
  return docxWithBody(
    p(run("Senior Engineer", { bold: true }) + run(" at Acme GmbH")),
  );
}

/** Same effective formatting, rPr children in different orders —
 * documents the (accepted) non-merge behavior of serialized comparison. */
export function reorderedRPrDoc(): Uint8Array {
  return docxWithBody(
    p(
      run("first half", { rPrRaw: "<w:rPr><w:b/><w:i/></w:rPr>" }) +
        run(" second half", { rPrRaw: "<w:rPr><w:i/><w:b/></w:rPr>" }),
    ),
  );
}

export function tableDoc(): Uint8Array {
  const cell = (w: string, content: string) =>
    `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/></w:tcPr>${content}</w:tc>`;
  const table =
    "<w:tbl>" +
    '<w:tblPr><w:tblW w:w="9638" w:type="dxa"/></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="6638"/></w:tblGrid>' +
    "<w:tr>" +
    cell("3000", para("Skills") + para("Python")) +
    cell("6638", para("Experience") + para("Data Engineer, Beispiel AG")) +
    "</w:tr></w:tbl>" +
    p("");
  return docxWithBody(table);
}

export const DRAWING_BOX_TEXT = "SIDEBAR-DRAWINGML-TEXT";

export function drawingBoxDoc(): Uint8Array {
  const boxParas = para(DRAWING_BOX_TEXT) + para("Sidebar bullet.");
  const drawing =
    p(
      "<w:r><w:drawing>" +
        '<wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="2" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">' +
        '<wp:simplePos x="0" y="0"/>' +
        '<wp:positionH relativeFrom="page"><wp:posOffset>360000</wp:posOffset></wp:positionH>' +
        '<wp:positionV relativeFrom="page"><wp:posOffset>720000</wp:posOffset></wp:positionV>' +
        '<wp:extent cx="1900800" cy="4320000"/>' +
        '<wp:wrapSquare wrapText="bothSides"/>' +
        '<wp:docPr id="1" name="SidebarBox"/>' +
        '<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">' +
        "<wps:wsp><wps:cNvSpPr/><wps:spPr>" +
        '<a:xfrm><a:off x="0" y="0"/><a:ext cx="1900800" cy="4320000"/></a:xfrm>' +
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
        "</wps:spPr>" +
        `<wps:txbx><w:txbxContent>${boxParas}</w:txbxContent></wps:txbx>` +
        '<wps:bodyPr rot="0" vert="horz" wrap="square" anchor="t"/>' +
        "</wps:wsp></a:graphicData></a:graphic></wp:anchor>" +
        "</w:drawing></w:r>",
    ) + para("Main column body text.");
  return docxWithBody(drawing);
}

export const VML_BOX_TEXT = "SIDEBAR-VML-TEXT";

export function vmlBoxDoc(): Uint8Array {
  const boxParas = para(VML_BOX_TEXT);
  const pict = p(
    "<w:r><w:pict>" +
      '<v:shape id="_x0000_s1026" style="position:absolute;width:150pt;height:340pt" fillcolor="#eeeeee">' +
      `<v:textbox><w:txbxContent>${boxParas}</w:txbxContent></v:textbox>` +
      "</v:shape>" +
      "</w:pict></w:r>",
  );
  return docxWithBody(pict + para("Main column body text."));
}

export const ALTERNATE_PROBE = "PROBE-ALTERNATE-CONTENT-UNIQUE-PHRASE";

/** The same text box encoded twice: mc:Choice (DrawingML) + mc:Fallback
 * (VML) carrying the SAME probe phrase — the duplication trap. */
export function alternateContentDoc(): Uint8Array {
  const boxParas = para(ALTERNATE_PROBE);
  const choice =
    '<mc:Choice Requires="wps"><w:drawing>' +
    '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="2" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="page"><wp:posOffset>360000</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="page"><wp:posOffset>720000</wp:posOffset></wp:positionV>' +
    '<wp:extent cx="1900800" cy="1000000"/>' +
    '<wp:docPr id="3" name="DualBox"/>' +
    '<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">' +
    "<wps:wsp><wps:cNvSpPr/><wps:spPr>" +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
    "</wps:spPr>" +
    `<wps:txbx><w:txbxContent>${boxParas}</w:txbxContent></wps:txbx>` +
    '<wps:bodyPr wrap="square"/>' +
    "</wps:wsp></a:graphicData></a:graphic></wp:anchor>" +
    "</w:drawing></mc:Choice>";
  const fallback =
    "<mc:Fallback><w:pict>" +
    '<v:shape id="_x0000_s2049" style="position:absolute;width:150pt;height:80pt">' +
    `<v:textbox><w:txbxContent>${boxParas}</w:txbxContent></v:textbox>` +
    "</v:shape>" +
    "</w:pict></mc:Fallback>";
  const body =
    p(
      `<w:r><mc:AlternateContent>${choice}${fallback}</mc:AlternateContent></w:r>`,
    ) + para("Body text after the dual-encoded box.");
  return docxWithBody(body);
}

export function hyperlinkDoc(): Uint8Array {
  const docRels =
    XML_DECL +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com" TargetMode="External"/>' +
    "</Relationships>";
  const body = p(
    run("See ") +
      `<w:hyperlink r:id="rId9">${run("my portfolio")}</w:hyperlink>` +
      run(" for details."),
  );
  return buildDocx({
    "[Content_Types].xml": contentTypes(),
    "_rels/.rels": ROOT_RELS,
    "word/document.xml": documentXml(body),
    "word/_rels/document.xml.rels": docRels,
  });
}

export const HEADER_TEXT = "Jane Q. Applicant · jane@example.com";
export const FOOTER_TEXT = "Page ";

export function headerFooterDoc(): Uint8Array {
  const overrides =
    '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
    '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>';
  const docRels =
    XML_DECL +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>' +
    "</Relationships>";
  const header = `${XML_DECL}<w:hdr ${NSDECLS}>${para(HEADER_TEXT, { bold: true })}</w:hdr>`;
  const footer =
    `${XML_DECL}<w:ftr ${NSDECLS}><w:p>${run(FOOTER_TEXT)}` +
    `<w:fldSimple w:instr=" PAGE ">${run("1")}</w:fldSimple></w:p></w:ftr>`;
  const sectPr =
    "<w:sectPr>" +
    '<w:headerReference w:type="default" r:id="rId1"/>' +
    '<w:footerReference w:type="default" r:id="rId2"/>' +
    '<w:pgSz w:w="11906" w:h="16838"/>' +
    "</w:sectPr>";
  return buildDocx({
    "[Content_Types].xml": contentTypes(overrides),
    "_rels/.rels": ROOT_RELS,
    "word/document.xml": documentXml(para("Body content."), sectPr),
    "word/_rels/document.xml.rels": docRels,
    "word/header1.xml": header,
    "word/footer1.xml": footer,
  });
}

export function imageDoc(): Uint8Array {
  const docRels =
    XML_DECL +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>' +
    "</Relationships>";
  const drawing = p(
    "<w:r><w:drawing>" +
      '<wp:inline distT="0" distB="0" distL="0" distR="0">' +
      '<wp:extent cx="914400" cy="914400"/>' +
      '<wp:docPr id="2" name="Portrait"/>' +
      '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      '<pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="image1.png"/><pic:cNvPicPr/></pic:nvPicPr>' +
      '<pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
      '<pic:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
      "</pic:pic></a:graphicData></a:graphic></wp:inline>" +
      "</w:drawing></w:r>",
  );
  return buildDocx({
    "[Content_Types].xml": contentTypes("", true),
    "_rels/.rels": ROOT_RELS,
    "word/document.xml": documentXml(
      para("Name") + drawing + para("After image."),
    ),
    "word/_rels/document.xml.rels": docRels,
    "word/media/image1.png": Buffer.from(makePng()),
  });
}

/** "Senior Engineer at Acme GmbH since 2021" — two fields, one segment. */
export const MULTI_FIELD_TEXT = "Senior Engineer at Acme GmbH since 2021";

export function multiFieldSegmentDoc(): Uint8Array {
  return docxWithBody(para(MULTI_FIELD_TEXT) + para("Second line."));
}

// -------------------------------------------------------------- reject cases

export function trackedChangesDoc(): Uint8Array {
  const body =
    p(
      run("Kept text ") +
        `<w:ins w:id="1" w:author="A" w:date="2026-01-01T00:00:00Z">${run("inserted text")}</w:ins>`,
    ) +
    p(
      '<w:del w:id="2" w:author="A" w:date="2026-01-01T00:00:00Z">' +
        '<w:r><w:delText xml:space="preserve">deleted text</w:delText></w:r>' +
        "</w:del>",
    );
  return docxWithBody(body);
}

export function externalFieldDoc(): Uint8Array {
  return docxWithBody(
    p(
      `<w:fldSimple w:instr=' INCLUDETEXT "C:\\\\evil.docx" '>${run("cached")}</w:fldSimple>`,
    ),
  );
}

export function externalInstrTextDoc(): Uint8Array {
  return docxWithBody(
    p(
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
        '<w:r><w:instrText xml:space="preserve"> DDEAUTO excel "book.xls" </w:instrText></w:r>' +
        '<w:r><w:fldChar w:fldCharType="end"/></w:r>',
    ),
  );
}

export function doctypeDoc(): Uint8Array {
  const evil =
    '<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY bar "baz">]>' +
    `<w:document ${NSDECLS}><w:body>${para("hi")}</w:body></w:document>`;
  return buildDocx({
    "[Content_Types].xml": contentTypes(),
    "_rels/.rels": ROOT_RELS,
    "word/document.xml": evil,
  });
}

export function markerCollisionDoc(): Uint8Array {
  return docxWithBody(para("This text contains a ⟦reserved⟧ glyph."));
}

export function macroDoc(): Uint8Array {
  return buildDocx({
    "[Content_Types].xml": contentTypes(),
    "_rels/.rels": ROOT_RELS,
    "word/document.xml": documentXml(para("hi")),
    "word/vbaProject.bin": Buffer.from([0x01, 0x02, 0x03]),
  });
}

/** adm-zip's writer sanitizes traversal names, so a hostile entry name
 * must be forged: write an innocent same-length name, then rewrite it in
 * the raw bytes (entry names appear in the local header + central
 * directory and are not covered by the entry CRC). */
export function pathTraversalDoc(): Uint8Array {
  const innocent = "word/evilname.xml";
  const hostile = "../../evil/nm.xml";
  const bytes = buildDocx({
    "[Content_Types].xml": contentTypes(),
    "_rels/.rels": ROOT_RELS,
    "word/document.xml": documentXml(para("hi")),
    [innocent]: "<evil/>",
  });
  const buf = Buffer.from(bytes);
  const needle = Buffer.from(innocent, "utf8");
  const replacement = Buffer.from(hostile, "utf8");
  let at = buf.indexOf(needle);
  while (at !== -1) {
    replacement.copy(buf, at);
    at = buf.indexOf(needle, at + 1);
  }
  return new Uint8Array(buf);
}

export function malformedXmlDoc(): Uint8Array {
  return buildDocx({
    "[Content_Types].xml": contentTypes(),
    "_rels/.rels": ROOT_RELS,
    "word/document.xml": `${XML_DECL}<w:document ${NSDECLS}><w:body><w:p>unclosed`,
  });
}

export function cfbBytes(): Uint8Array {
  return new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
}

export function notAZip(): Uint8Array {
  return new Uint8Array(Buffer.from("plain text, not an archive"));
}

// ------------------------------------------------------------------- helpers

function makePng(): Buffer {
  const width = 8;
  const height = 8;
  const chunk = (type: string, data: Buffer): Buffer => {
    const typeBuf = Buffer.from(type, "ascii");
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x55)]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
