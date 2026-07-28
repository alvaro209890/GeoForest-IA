import { Document, Packer, Paragraph, TextRun } from "docx";
import { buildCroquiDocxParagraphs } from "./narrative";

export async function buildCroquiDocxBuffer(
  narrative: string,
  atpInQuerencia = false,
): Promise<Buffer> {
  const paragraphs = buildCroquiDocxParagraphs(narrative, atpInQuerencia).map(
    (text) =>
      new Paragraph({
        children: [
          new TextRun({
            text,
            font: "Calibri",
            size: 22,
          }),
        ],
        spacing: { after: 120, line: 276 },
      }),
  );

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 },
          },
        },
        children: paragraphs.length ? paragraphs : [new Paragraph("")],
      },
    ],
  });
  return Packer.toBuffer(doc);
}
