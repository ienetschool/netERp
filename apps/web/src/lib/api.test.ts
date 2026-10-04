import { describe, expect, it } from 'vitest';
import { classifyRefreshFailure, type StoredTokens } from './api';

const pair = (accessToken: string, refreshToken: string): StoredTokens => ({ accessToken, refreshToken });

// Refresh tokens are single-use, so a failed rotation is ambiguous: it can mean
// the session is gone, or it can mean a sibling tab already rotated the pair
// while this request was in flight. These cases sit together because they are
// one contract — the second must never be mistaken for the first.
describe('classifyRefreshFailure', () => {
  it('signs out when the stored pair is still the pair that failed', () => {
    expect(classifyRefreshFailure(pair('access-1', 'refresh-1'), pair('access-1', 'refresh-1'))).toBe(
      'sign-out',
    );
  });

  it('adopts the newer pair when another tab already rotated it', () => {
    expect(classifyRefreshFailure(pair('access-1', 'refresh-1'), pair('access-2', 'refresh-2'))).toBe(
      'adopt-newer',
    );
  });

  it('never wipes a rotated pair just because the access token happens to match', () => {
    // Two tabs can end up with the same access token but different refresh
    // tokens; the refresh token is the one that decides.
    expect(classifyRefreshFailure(pair('access-2', 'refresh-1'), pair('access-2', 'refresh-2'))).toBe(
      'adopt-newer',
    );
  });

  it('signs out when storage is already empty', () => {
    expect(classifyRefreshFailure(pair('access-1', 'refresh-1'), null)).toBe('sign-out');
  });

  it('adopts when there was nothing to attempt but a usable pair is stored', () => {
    expect(classifyRefreshFailure(null, pair('access-2', 'refresh-2'))).toBe('adopt-newer');
  });

  it('signs out when there is neither an attempted nor a stored pair', () => {
    expect(classifyRefreshFailure(null, null)).toBe('sign-out');
  });
});