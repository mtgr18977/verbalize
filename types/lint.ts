/** One entry of Vale's JSON output (`--output=JSON`) for a single file. */
export interface ValeAction {
  Name: string;
  Params: string[] | null;
}

export interface ValeAlert {
  Action: ValeAction;
  /** 1-based columns of the match on its line; the end is inclusive. */
  Span: [number, number];
  Check: string;
  Description: string;
  Link: string;
  Message: string;
  Severity: string;
  Match: string;
  Line: number;
}

/** An alert of the current review, with a stable id that survives edits to the document. */
export interface ReviewAlert extends ValeAlert {
  id: number;
}

/** Where an alert is in the document right now, as tracked by the editor. */
export interface AlertPosition {
  from: number;
  to: number;
}
