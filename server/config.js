// Only these application-owned messages may reach startup logs.
export class StartupError extends Error {}
export function validateOrigin(origin, production) {
  try {
    const parsed=new URL(origin);
    if(parsed.origin!==origin || !['http:','https:'].includes(parsed.protocol) || parsed.username || parsed.password || (production && parsed.protocol!=='https:'))throw new Error();
  } catch {
    throw new StartupError('APP_ORIGIN must be a full origin without a trailing slash, such as https://pokedo.alebyte.me. Production requires HTTPS.');
  }
}
export function databaseFailure(error) {
  const codes=[error?.code,error?.cause?.code,error?.errorResponse?.code];
  if(codes.includes(18)||error?.codeName==='AuthenticationFailed')return new StartupError('Atlas authentication failed. Check MONGODB_USERNAME and MONGODB_PASSWORD in Render Environment; use an Atlas database user, not a PokeDo login.');
  if(codes.includes(13))return new StartupError('Atlas access denied. Give the database user access to MONGODB_DB.');
  if(codes.some(code=>['ENOTFOUND','ENODATA','ESERVFAIL'].includes(code)))return new StartupError('Atlas hostname lookup failed. Check the cluster hostname in MONGODB_URI.');
  return new StartupError('Atlas connection failed. Add this Render service’s outbound IP ranges to Atlas Network Access and verify its database credentials.');
}
export const startupMessage=error=>error instanceof StartupError?error.message:'Unexpected startup failure. Check the application configuration; no credentials are printed.';
