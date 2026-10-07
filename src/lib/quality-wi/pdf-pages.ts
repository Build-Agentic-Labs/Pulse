import PDFCatalog from "pdf-lib/es/core/structures/PDFCatalog";
import PDFContext from "pdf-lib/es/core/PDFContext";
import PDFHexString from "pdf-lib/es/core/objects/PDFHexString";
import PDFPageTree from "pdf-lib/es/core/structures/PDFPageTree";
import PDFWriter from "pdf-lib/es/core/writers/PDFWriter";
import PngEmbedder from "pdf-lib/es/core/embedders/PngEmbedder";

/** Use the library's image-only writer so preview does not load unused font/form machinery. */
export async function wiPdfFromPages(
  pages: Uint8Array[],
  title: string,
  subject: string,
) {
  const context = PDFContext.create();
  const tree = PDFPageTree.withContext(context);
  const treeRef = context.register(tree);
  context.trailerInfo.Root = context.register(
    PDFCatalog.withContextAndPages(context, treeRef),
  );
  context.trailerInfo.Info = context.register(
    context.obj({
      Title: PDFHexString.fromText(title),
      Subject: PDFHexString.fromText(subject),
    }),
  );
  for (const bytes of pages) {
    const image = await PngEmbedder.for(bytes);
    const imageRef = await image.embedIntoContext(context);
    const contents = context.register(
      context.stream("q 612 0 0 792 0 0 cm /PageImage Do Q"),
    );
    const pageRef = context.register(
      context.obj({
        Type: "Page",
        Parent: treeRef,
        MediaBox: [0, 0, 612, 792],
        Resources: { XObject: { PageImage: imageRef } },
        Contents: contents,
      }),
    );
    tree.pushLeafNode(pageRef);
  }
  return new Blob(
    [
      new Uint8Array(
        await PDFWriter.forContext(context, 50).serializeToBuffer(),
      ),
    ],
    { type: "application/pdf" },
  );
}
