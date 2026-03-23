declare module '../../api/health/*.js' {
  const handler: (req: unknown, res: unknown) => Promise<void>;
  export default handler;
}
