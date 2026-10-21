import { describe, it, expect, vi, afterEach } from 'vitest';
import { AdoRequestError, AzureDevOpsService, adoRequest } from '../AzureDevOpsService';

const config = { organizationUrl: 'https://dev.azure.com/org/', project: 'My Proj', pat: 'p' };

function stubFetch(status: number, body: unknown, contentType = 'application/json') {
  const fetchMock = vi.fn(
    async () =>
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        headers: { 'content-type': contentType },
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('adoRequest', () => {
  it('works detached from the class, and asks ADO not to redirect to a sign-in page', async () => {
    const fetchMock = stubFetch(200, { ok: 1 });
    const request = adoRequest; // passed around as a plain function
    expect(await request(config, 'proj/_apis/x')).toEqual({ ok: 1 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://dev.azure.com/org/proj/_apis/x?api-version=7.1');
    expect((init.headers as Record<string, string>)['X-TFS-FedAuthRedirect']).toBe('Suppress');
  });

  it('throws an AdoRequestError carrying the status', async () => {
    stubFetch(401, 'nope', 'text/plain');
    const err = await adoRequest(config, 'x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AdoRequestError);
    expect((err as AdoRequestError).status).toBe(401);
  });
});

describe('AzureDevOpsService.getMyId', () => {
  it('reads the token owner from connectionData on the preview API version', async () => {
    const fetchMock = stubFetch(200, {
      authenticatedUser: { id: 'f362db1a-7bc6-6004-abf3-d68de653fcef' },
    });
    expect(await AzureDevOpsService.getMyId(config)).toBe('f362db1a-7bc6-6004-abf3-d68de653fcef');
    expect(String((fetchMock.mock.calls[0] as unknown as [string])[0])).toBe(
      'https://dev.azure.com/org/_apis/connectionData?api-version=7.1-preview',
    );
  });

  it('refuses the anonymous identity', async () => {
    stubFetch(200, { authenticatedUser: { id: '00000000-0000-0000-0000-000000000000' } });
    await expect(AzureDevOpsService.getMyId(config)).rejects.toBeInstanceOf(AdoRequestError);
  });
});
