declare module 'partial-json' {
  export const STR: number;
  export const NUM: number;
  export const ARR: number;
  export const OBJ: number;
  export const NULL: number;
  export const BOOL: number;
  export const NAN: number;
  export const INFINITY: number;
  export const _INFINITY: number;
  export const INF: number;
  export const SPECIAL: number;
  export const ATOM: number;
  export const COLLECTION: number;
  export const ALL: number;

  export const Allow: {
    STR: number;
    NUM: number;
    ARR: number;
    OBJ: number;
    NULL: number;
    BOOL: number;
    NAN: number;
    INFINITY: number;
    _INFINITY: number;
    INF: number;
    SPECIAL: number;
    ATOM: number;
    COLLECTION: number;
    ALL: number;
  };

  export class PartialJSON extends Error {}
  export class MalformedJSON extends Error {}

  export function parse(jsonString: string, allowPartial?: number): any;
  export function parseJSON(jsonString: string, allowPartial?: number): any;
}

export {};
