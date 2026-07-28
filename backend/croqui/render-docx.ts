import { Document, Packer, Paragraph, TextRun } from "docx";

export async function buildCroquiDocxBuffer(narrative: string): Promise<Buffer> {
  const paragraphs = narrative
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(
      (line) =>
        new Paragraph({
          children: [new TextRun({ text: line, size: 24 })],
          spacing: { after: 200 },
        }),
    );
  const doc = new Document({
    sections: [{ properties: {}, children: paragraphs.length ? paragraphs : [new Paragraph("")] }],
  });
  return Packer.toBuffer(doc);
}
