import { formatSopNumber } from "@/domain/sop/numbering";
import { WI_DOCUMENT_TYPE, type GeneralWorkInstruction } from "./work-instruction-template";

/**
 * Example general work instruction (Purchasing) used to show departments what
 * a finished document looks like. Sample content — not a released procedure.
 * Image keys name illustrative screens supplied by the caller.
 */
export const SAMPLE_GENERAL_WORK_INSTRUCTION: GeneralWorkInstruction = {
  title: "Issue a Purchase Order",
  documentNumber: formatSopNumber("PUR", WI_DOCUMENT_TYPE, 1), // WI-PUR-001
  revision: "A",
  revisionDate: "10/06/2026",
  revisionDescription: "Initial release",
  purpose:
    "Issue a purchase order to an approved supplier from a released purchase requisition. Applies to all Purchasing buyers, for production and non-production purchases.",
  responsibilities:
    "Buyer — creates, sends and confirms the PO.  Purchasing Manager — approves POs over $5,000.  Requester — confirms specifications when asked.",
  steps: [
    {
      title: "Open the requisition",
      instruction:
        "Open Purchasing › Requisitions and select the released requisition.\nConfirm part number, quantity, need-by date and account are complete.",
      image: "requisition",
    },
    {
      title: "Confirm the supplier",
      instruction:
        "Check the supplier on the Approved Supplier List.\nStatus must read Approved. If not, stop and contact Quality before buying.",
      image: "supplier",
    },
    {
      title: "Create the purchase order",
      instruction:
        "Select Convert to PO.\nEnter the unit price from the quote, payment terms and ship-to address. Save as draft.",
      image: "po-form",
    },
    {
      title: "Attach the quote",
      instruction:
        "Attach the supplier's quote (PDF) under Attachments.\nThe quote number must match the PO reference field.",
      image: "attachments",
    },
    {
      title: "Route for approval",
      instruction:
        "Submit the PO. Orders over $5,000 route to the Purchasing Manager automatically.\nDo not send the PO until it shows Approved.",
      image: "approval",
    },
    {
      title: "Send and confirm",
      instruction:
        "Email the approved PO to the supplier contact.\nRecord the supplier's acknowledgment and promised date within 2 business days.",
      image: "confirm",
    },
  ],
};
