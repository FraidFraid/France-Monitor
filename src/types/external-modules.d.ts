declare module './government-data.js' {
  export const GOUVERNEMENT_DATA: unknown[];
}

declare module '../../api/_shared/ministers.js' {
  export function handleMinistersRequest(req: { url?: string }, res: {
    statusCode?: number;
    setHeader(name: string, value: string): void;
    end(body?: string): void;
  }): Promise<boolean>;
}
