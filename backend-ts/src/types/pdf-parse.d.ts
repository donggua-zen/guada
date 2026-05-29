declare module "pdf-parse" {
  interface PDFParseOptions {
    data: Buffer;
    verbosity?: number;
  }

  interface PDFParseTextResult {
    text: string;
    total: number;
    pages: Array<{ text: string; num: number }>;
  }

  class PDFParseClass {
    constructor(options: PDFParseOptions);
    getText(options?: any): Promise<PDFParseTextResult>;
    getInfo(options?: any): Promise<any>;
    load(): Promise<any>;
    destroy(): Promise<void>;
  }

  const pdfParseModule: {
    PDFParse: typeof PDFParseClass;
    AbortException: any;
    FormatError: any;
    InvalidPDFException: any;
    PasswordException: any;
    UnknownErrorException: any;
    ResponseException: any;
    getException: any;
  };

  export = pdfParseModule;
}
