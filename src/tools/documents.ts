/** Documents, workspaces, versions and elements. */

import { z } from "zod";

import { run } from "./feature-helpers.js";
import { docShape, docWsShape, requireDoc, requireDocWs, targetShape, requireTarget } from "./shapes.js";
import type { ToolDef } from "./types.js";

const FILTERS: Record<string, number | undefined> = { all: undefined, owned: 1, created: 4, shared: 5 };

export const documentTools: ToolDef[] = [
  {
    name: "onshape_list_documents",
    title: "List Onshape documents",
    description: "List documents visible to the signed-in user, most recently modified first.",
    inputSchema: {
      filter: z.enum(["all", "owned", "created", "shared"]).optional().describe("Which documents to list (default all)."),
      limit: z.number().int().min(1).max(100).optional().describe("How many to return (default 20)."),
      sort_by: z.string().optional().describe("Sort column, e.g. modifiedAt or name (default modifiedAt)."),
      sort_order: z.enum(["asc", "desc"]).optional().describe("Sort direction (default desc)."),
    },
    annotations: { readOnlyHint: true },
    handler: (args, ctx) =>
      run(ctx, () =>
        ctx.api().documents.listDocuments({
          filterType: FILTERS[args.filter ?? "all"],
          limit: args.limit ?? 20,
          sortBy: args.sort_by ?? "modifiedAt",
          sortOrder: args.sort_order ?? "desc",
        }),
      ),
  },
  {
    name: "onshape_search_documents",
    title: "Search Onshape documents",
    description: "Find documents by name. Search before creating, so repeated runs do not make duplicates.",
    inputSchema: {
      query: z.string().min(1).describe("Text to match against document names."),
      limit: z.number().int().min(1).max(100).optional().describe("How many to return (default 20)."),
    },
    annotations: { readOnlyHint: true },
    handler: (args, ctx) => run(ctx, () => ctx.api().documents.searchDocuments(args.query, args.limit ?? 20)),
  },
  {
    name: "onshape_get_document",
    title: "Get an Onshape document",
    description: "Read one document's metadata, including its default workspace id.",
    inputSchema: { ...docShape },
    annotations: { readOnlyHint: true },
    handler: (args, ctx) => run(ctx, () => ctx.api().documents.getDocument(requireDoc(args))),
  },
  {
    name: "onshape_get_document_summary",
    title: "Summarize an Onshape document",
    description:
      "Document metadata plus every workspace and the elements (tabs) inside each — the fastest way to orient in an " +
      "unfamiliar document and collect the ids other tools need.",
    inputSchema: { ...docShape },
    annotations: { readOnlyHint: true },
    handler: (args, ctx) => run(ctx, () => ctx.api().documents.getDocumentSummary(requireDoc(args))),
  },
  {
    name: "onshape_create_document",
    title: "Create an Onshape document",
    description:
      "Create a document. Free Onshape accounts may only create public documents, so pass public=true there. The " +
      "result carries the new document id and its default workspace id.",
    inputSchema: {
      name: z.string().min(1).describe("Document name."),
      public: z.boolean().optional().describe("Make the document public (required on free accounts)."),
      description: z.string().optional().describe("Document description."),
    },
    handler: (args, ctx) =>
      run(ctx, () => ctx.api().documents.createDocument(args.name, Boolean(args.public), args.description)),
  },
  {
    name: "onshape_update_document",
    title: "Rename an Onshape document",
    description: "Change a document's name or description.",
    inputSchema: {
      ...docShape,
      name: z.string().optional().describe("New name."),
      description: z.string().optional().describe("New description."),
    },
    handler: (args, ctx) =>
      run(ctx, () => ctx.api().documents.updateDocument(requireDoc(args), args.name, args.description)),
  },
  {
    name: "onshape_delete_document",
    title: "Delete an Onshape document",
    description: "Move a document to the trash. This affects the whole document, not a single tab.",
    inputSchema: { ...docShape },
    annotations: { destructiveHint: true },
    handler: (args, ctx) => run(ctx, () => ctx.api().documents.deleteDocument(requireDoc(args))),
  },
  {
    name: "onshape_get_workspaces",
    title: "List workspaces",
    description: "List a document's workspaces (branches).",
    inputSchema: { ...docShape },
    annotations: { readOnlyHint: true },
    handler: (args, ctx) => run(ctx, () => ctx.api().documents.getWorkspaces(requireDoc(args))),
  },
  {
    name: "onshape_get_elements",
    title: "List elements in a workspace",
    description: "List the elements (tabs) in a workspace: Part Studios, assemblies, drawings, Feature Studios.",
    inputSchema: {
      ...docWsShape,
      type: z
        .enum(["PARTSTUDIO", "ASSEMBLY", "DRAWING", "FEATURESTUDIO", "BLOB", "APPLICATION", "TABLE", "VARIABLESTUDIO"])
        .optional()
        .describe("Only return elements of this type."),
    },
    annotations: { readOnlyHint: true },
    handler: (args, ctx) => {
      const { doc, ws } = requireDocWs(args);
      return run(ctx, () => ctx.api().documents.getElements(doc, ws, args.type));
    },
  },
  {
    name: "onshape_find_part_studios",
    title: "Find Part Studios by name",
    description: "List the Part Studios in a workspace, optionally filtered by a substring of the name.",
    inputSchema: { ...docWsShape, name: z.string().optional().describe("Case-insensitive substring to match.") },
    annotations: { readOnlyHint: true },
    handler: (args, ctx) => {
      const { doc, ws } = requireDocWs(args);
      return run(ctx, () => ctx.api().documents.findPartStudios(doc, ws, args.name));
    },
  },
  {
    name: "onshape_list_versions",
    title: "List document versions",
    description: "List the immutable versions of a document, newest first.",
    inputSchema: { ...docShape },
    annotations: { readOnlyHint: true },
    handler: (args, ctx) => run(ctx, () => ctx.api().documents.getVersions(requireDoc(args))),
  },
  {
    name: "onshape_create_version",
    title: "Create a document version",
    description:
      "Snapshot the workspace as an immutable version. Do this before restructuring an existing design: it is the " +
      "only way back to the previous state, and drawings must reference a version.",
    inputSchema: {
      ...docWsShape,
      name: z.string().min(1).describe("Version name, e.g. what is about to change."),
      description: z.string().optional().describe("Why this snapshot was taken."),
    },
    handler: (args, ctx) => {
      const { doc, ws } = requireDocWs(args);
      return run(ctx, () => ctx.api().documents.createVersion(doc, ws, args.name, args.description));
    },
  },
  {
    name: "onshape_delete_element",
    title: "Delete an element",
    description: "Delete one element (tab) from a workspace.",
    inputSchema: { ...targetShape },
    annotations: { destructiveHint: true },
    handler: (args, ctx) => {
      const t = requireTarget(args);
      return run(ctx, () => ctx.api().partStudios.deleteElement(t.doc, t.ws, t.elem));
    },
  },
];
