/** Expected, user-facing failures from the organization services. */
export class OrgError extends Error {
  constructor(message: string, readonly code: 'slug_taken' | 'not_found' | 'forbidden' | 'invalid' | 'last_owner' | 'conflict') {
    super(message);
  }
}
