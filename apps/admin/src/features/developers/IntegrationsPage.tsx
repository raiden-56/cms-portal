import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link as RouterLink } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Step from '@mui/material/Step';
import StepContent from '@mui/material/StepContent';
import StepLabel from '@mui/material/StepLabel';
import Stepper from '@mui/material/Stepper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import ArrowBackOutlined from '@mui/icons-material/ArrowBackOutlined';
import ArrowForwardOutlined from '@mui/icons-material/ArrowForwardOutlined';
import CheckCircleOutlined from '@mui/icons-material/CheckCircleOutlined';
import ErrorOutlineOutlined from '@mui/icons-material/ErrorOutlineOutlined';
import HubOutlined from '@mui/icons-material/HubOutlined';
import KeyOutlined from '@mui/icons-material/KeyOutlined';
import RadioButtonCheckedOutlined from '@mui/icons-material/RadioButtonCheckedOutlined';
import RadioButtonUncheckedOutlined from '@mui/icons-material/RadioButtonUncheckedOutlined';
import RefreshOutlined from '@mui/icons-material/RefreshOutlined';
import WebhookOutlined from '@mui/icons-material/WebhookOutlined';
import type { TokenType } from '@meridian/shared';
import { ENVIRONMENT_TONES } from '@/app/nav';
import { useCrumbs } from '@/app/shell';
import { useProject, useSchema } from '@/app/workspace';
import { CodeBlock, EmptyState, ErrorState, FormError, Mono, Page, PageHeader, Pill, RelativeTime, Section, TableSkeleton } from '@/components/ui';
import { API_URL, api, deliveryFetch, errorMessage } from '@/lib/api';
import { compactNumber } from '@/lib/format';
import type { ApiToken } from '@/lib/types';
import { toast } from '@/store';
import { FONT_MONO } from '@/theme/theme';
import { EnvironmentLabel, NoAccess, SecretBox, Snippets, TOKEN_TYPE_INFO, TokenTypePill, isConnected, useTokens } from './shared';
import { FRAMEWORKS, type Framework, envSnippet, frameworkInfo, installSnippet, sampleSnippets, snippetContext } from './snippets';

const STEPS = ['Framework', 'Environment', 'Access', 'Credentials', 'Install', 'Sample code', 'Test connection', 'Verify content', 'Connected'] as const;

type Probe = Awaited<ReturnType<typeof deliveryFetch>>;

function ChoiceCard({ selected, onSelect, children, label }: { selected: boolean; onSelect: () => void; children: ReactNode; label: string }) {
  return (
    <ButtonBase
      role="radio"
      aria-checked={selected}
      aria-label={label}
      onClick={onSelect}
      sx={{ p: 3.5, gap: 3, borderRadius: '8px', border: 1, borderColor: selected ? 'secondary.main' : 'border.strong', bgcolor: selected ? 'action.selected' : 'background.paper', alignItems: 'flex-start', justifyContent: 'flex-start', textAlign: 'left', transition: 'border-color 120ms, background-color 120ms', '&:hover': { borderColor: selected ? 'secondary.main' : 'text.disabled' } }}
    >
      {children}
    </ButtonBase>
  );
}

function ProbeResult({ probe, children }: { probe: Probe; children?: ReactNode }) {
  return (
    <Box sx={{ border: 1, borderColor: probe.ok ? 'border.subtle' : 'error.main', borderRadius: '8px', overflow: 'hidden' }}>
      <Stack direction="row" spacing={3} sx={{ px: 3.5, py: 2.5, alignItems: 'center', bgcolor: 'surface.subtle', flexWrap: 'wrap', rowGap: 1 }}>
        {probe.ok ? <CheckCircleOutlined sx={{ fontSize: 18, color: 'success.main' }} /> : <ErrorOutlineOutlined sx={{ fontSize: 18, color: 'error.main' }} />}
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
          {probe.ok ? 'Success' : 'Request failed'}
        </Typography>
        <Pill label={`HTTP ${probe.status}`} fg={probe.ok ? 'success.dark' : 'error.dark'} bg={probe.ok ? 'success.light' : 'error.light'} />
        <Typography variant="caption" color="text.secondary">
          {probe.durationMs} ms
        </Typography>
      </Stack>
      {children && <Box sx={{ p: 3.5 }}>{children}</Box>}
    </Box>
  );
}

function excerpt(value: unknown, limit = 1400): string {
  const text = JSON.stringify(value, null, 2) ?? '';
  return text.length > limit ? `${text.slice(0, limit)}\n… (${text.length - limit} more characters)` : text;
}

export default function IntegrationsPage() {
  const ws = useProject();
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down('lg'));
  const queryClient = useQueryClient();
  const schema = useSchema();
  const tokens = useTokens();
  useCrumbs([]);

  const [active, setActive] = useState(0);
  const [framework, setFramework] = useState<Framework | null>(null);
  const [environmentId, setEnvironmentId] = useState(ws.environment.id);
  const [access, setAccess] = useState<TokenType>('READ_ONLY');
  const [issued, setIssued] = useState<{ token: ApiToken; secret: string } | null>(null);
  const [connection, setConnection] = useState<Probe | null>(null);
  const [content, setContent] = useState<Probe | null>(null);
  const [probeError, setProbeError] = useState<unknown>(null);
  const [probing, setProbing] = useState(false);
  /** Successful requests already recorded for the key when the verify step was opened (server-side keys). */
  const [baseline, setBaseline] = useState<number | null>(null);

  const ctx = useMemo(() => snippetContext(API_URL, schema.data), [schema.data]);
  const info = framework ? frameworkInfo(framework) : null;
  const environment = ws.project.environments.find((e) => e.id === environmentId) ?? ws.environment;
  // A key generated for another environment or access level cannot be reused after the choice changes.
  const credential = issued && issued.token.environmentId === environmentId && issued.token.type === access ? issued : null;
  const secretKey = TOKEN_TYPE_INFO[access].secret;
  const live = credential ? tokens.data?.find((t) => t.id === credential.token.id) : undefined;
  const successes = live ? live.requests7d - live.errors7d : 0;

  const generate = useMutation({
    mutationFn: () =>
      api.post<ApiToken>(`${ws.projectBase}/tokens`, {
        name: `${info?.label ?? 'New'} app`,
        description: `Created by the integration wizard for ${environment.name}`,
        type: access,
        environmentId,
      }),
    onSuccess: async (token) => {
      if (token.token) setIssued({ token, secret: token.token });
      setConnection(null);
      setContent(null);
      setBaseline(null);
      await queryClient.invalidateQueries({ queryKey: ['tokens', ws.project.id] });
    },
  });

  // Server-side keys cannot be exercised from this browser, so watch for the first requests instead.
  const watching = !!credential && secretKey && (active === 6 || active === 7);
  useEffect(() => {
    if (!watching) return;
    const id = setInterval(() => void tokens.refetch(), 4000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watching]);

  useEffect(() => {
    if (active === 7 && secretKey && baseline === null && live) setBaseline(successes);
  }, [active, secretKey, baseline, live, successes]);

  useEffect(() => {
    if (active !== 8) return;
    // The key has now been used, so it appears under connected applications and on the dashboard.
    void queryClient.invalidateQueries({ queryKey: ['tokens', ws.project.id] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  }, [active, queryClient, ws.project.id]);

  if (!ws.can('token.manage')) return <NoAccess title="integrations" what="create API keys for applications" />;

  const probe = async (path: string, set: (result: Probe) => void) => {
    if (!credential) return;
    setProbing(true);
    setProbeError(null);
    try {
      set(await deliveryFetch(path, credential.secret));
    } catch (err) {
      setProbeError(err);
    } finally {
      setProbing(false);
    }
  };

  const reset = () => {
    setActive(0);
    setFramework(null);
    setEnvironmentId(ws.environment.id);
    setAccess('READ_ONLY');
    setIssued(null);
    setConnection(null);
    setContent(null);
    setProbeError(null);
    setBaseline(null);
    generate.reset();
  };

  const connectionOk = secretKey ? !!live?.lastUsedAt : !!connection?.ok;
  const contentOk = secretKey ? baseline !== null && successes > baseline : !!content?.ok;
  const canContinue = [!!framework, true, true, !!credential, true, true, connectionOk, contentOk, true][active];
  const connected = (tokens.data ?? []).filter((t) => t.lastUsedAt && t.status !== 'revoked');
  const curl = (path: string) => `curl -H "Authorization: Bearer $MERIDIAN_API_KEY" \\\n  "${API_URL}/api/v1${path}"`;
  const contentBody = content?.body as { data?: unknown; meta?: { total?: number } } | null | undefined;
  const contentData = contentBody?.data;
  const firstItem: unknown = Array.isArray(contentData) ? contentData[0] : contentData;
  const total = contentBody?.meta?.total ?? (Array.isArray(contentData) ? contentData.length : contentData ? 1 : 0);

  const body: ReactNode = (() => {
    switch (active) {
      case 0:
        return (
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Pick what you are building with. The steps that follow are tailored to it.
            </Typography>
            <Box role="radiogroup" aria-label="Framework" sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 3 }}>
              {FRAMEWORKS.map((f) => (
                <ChoiceCard key={f.id} label={f.label} selected={framework === f.id} onSelect={() => setFramework(f.id)}>
                  <Box sx={{ width: 34, height: 34, borderRadius: '8px', bgcolor: framework === f.id ? 'secondary.main' : 'surface.sunken', color: framework === f.id ? 'secondary.contrastText' : 'text.secondary', display: 'grid', placeItems: 'center', flexShrink: 0, fontFamily: FONT_MONO, fontSize: '0.75rem', fontWeight: 600 }}>
                    {f.mark}
                  </Box>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                      {f.label}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {f.tagline}
                    </Typography>
                  </Box>
                </ChoiceCard>
              ))}
            </Box>
          </Box>
        );
      case 1:
        return (
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              The application will read from <b>{ws.project.name}</b>. Choose the environment it should be connected to — each environment has its own content and its own keys.
            </Typography>
            <Box role="radiogroup" aria-label="Environment" sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 3 }}>
              {ws.project.environments.map((env) => (
                <ChoiceCard key={env.id} label={env.name} selected={environmentId === env.id} onSelect={() => setEnvironmentId(env.id)}>
                  <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: ENVIRONMENT_TONES[env.key] ?? 'text.disabled', mt: 1.5, flexShrink: 0 }} />
                  <Box>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                      {env.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {env.entryCount} {env.entryCount === 1 ? 'entry' : 'entries'}
                    </Typography>
                  </Box>
                </ChoiceCard>
              ))}
            </Box>
          </Box>
        );
      case 2:
        return (
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Give the application the least access it needs.
            </Typography>
            <Stack spacing={2} role="radiogroup" aria-label="Access level" sx={{ maxWidth: 720 }}>
              {(['READ_ONLY', 'PREVIEW', 'READ_WRITE'] as TokenType[]).map((type) => {
                const t = TOKEN_TYPE_INFO[type];
                const selected = access === type;
                return (
                  <ChoiceCard key={type} label={t.label} selected={selected} onSelect={() => setAccess(type)}>
                    {selected ? <RadioButtonCheckedOutlined sx={{ fontSize: 18, color: 'secondary.main', mt: 0.25 }} /> : <RadioButtonUncheckedOutlined sx={{ fontSize: 18, color: 'text.disabled', mt: 0.25 }} />}
                    <Box>
                      <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                          {type === 'READ_ONLY' ? 'Read-only — public content' : type === 'PREVIEW' ? 'Preview — drafts included' : 'Read/write — manage content'}
                        </Typography>
                        {t.secret ? <Pill label="Server-side secret" fg="warning.dark" bg="warning.light" /> : <Pill label="Browser-safe" fg="success.dark" bg="success.light" />}
                      </Stack>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        {t.detail}
                      </Typography>
                    </Box>
                  </ChoiceCard>
                );
              })}
            </Stack>
            <Alert severity={secretKey && info?.runtime !== 'server' ? 'warning' : 'info'} sx={{ mt: 4, maxWidth: 720 }}>
              {secretKey && info?.runtime !== 'server'
                ? `${info?.label} code runs ${info?.runtime === 'browser' ? 'in the browser' : 'on people’s devices'}, where a secret key can be extracted. Use a read-only key there and keep ${TOKEN_TYPE_INFO[access].label.toLowerCase()} keys on a server you control.`
                : 'Secret keys must never ship in browser or mobile code. Anything bundled into a client can be read by anyone who downloads it.'}
            </Alert>
          </Box>
        );
      case 3:
        return (
          <Box sx={{ maxWidth: 720 }}>
            {credential ? (
              <>
                <Alert severity="warning" sx={{ mb: 3 }}>
                  Copy this key now. It is <b>shown only once</b> — when you leave this wizard it cannot be retrieved, only rotated.
                </Alert>
                <SecretBox value={credential.secret} label="API key" />
                <Stack direction="row" spacing={3} sx={{ mt: 3, alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    {credential.token.name}
                  </Typography>
                  <TokenTypePill type={credential.token.type} />
                  <EnvironmentLabel environmentId={credential.token.environmentId} />
                  <Typography variant="caption" color="text.secondary">
                    {compactNumber(credential.token.rateLimitPerMinute)} requests/min
                  </Typography>
                </Stack>
              </>
            ) : (
              <>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                  This creates a {TOKEN_TYPE_INFO[access].label.toLowerCase()} key named <b>{info?.label} app</b> for <b>{environment.name}</b>. You can rename it, restrict its origins or
                  change its rate limit later under API Keys.
                </Typography>
                {issued && (
                  <Alert severity="info" sx={{ mb: 3 }}>
                    The key generated earlier (<Mono>{issued.token.prefix}…</Mono>) was for a different environment or access level. It still exists — revoke it under API Keys if
                    you no longer need it.
                  </Alert>
                )}
                <FormError error={generate.error} />
                <Button variant="contained" startIcon={<KeyOutlined />} onClick={() => generate.mutate()} loading={generate.isPending}>
                  Generate key
                </Button>
              </>
            )}
          </Box>
        );
      case 4: {
        const install = framework ? installSnippet(framework) : null;
        return (
          <Stack spacing={4} sx={{ maxWidth: 820 }}>
            {install && (
              <Box>
                <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
                  1. Install
                </Typography>
                <CodeBlock code={install.code} language={install.language} />
              </Box>
            )}
            {framework && credential && (
              <Box>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                  {install ? '2. ' : ''}Add your credentials
                </Typography>
                <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1.5, fontFamily: FONT_MONO }}>
                  {envSnippet(framework, API_URL, credential.secret).caption}
                </Typography>
                <CodeBlock code={envSnippet(framework, API_URL, credential.secret).code} language={envSnippet(framework, API_URL, credential.secret).language} />
                <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 2, mb: 0 }}>
                  {secretKey
                    ? 'Keep this file out of source control and never expose these variables to client-side code.'
                    : 'A read-only key may be bundled into client code. Still keep environment files out of source control so each environment uses its own key.'}
                </Typography>
              </Box>
            )}
          </Stack>
        );
      }
      case 5:
        return (
          <Box sx={{ maxWidth: 900 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              These examples use this project’s real content model — <Mono>{ctx.type}</Mono> is one of your content types.
            </Typography>
            {framework && <Snippets items={sampleSnippets(framework, ctx)} maxHeight={460} />}
          </Box>
        );
      case 6:
        return (
          <Box sx={{ maxWidth: 820 }}>
            {secretKey ? (
              <>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                  {TOKEN_TYPE_INFO[access].label} keys are refused from browsers by design, so this page cannot test the key for you. Run this from the server that will use it;
                  the first request is detected here automatically.
                </Typography>
                <CodeBlock language="bash" code={curl('/')} />
                <Stack direction="row" spacing={3} sx={{ mt: 3, alignItems: 'center' }}>
                  {live?.lastUsedAt ? (
                    <>
                      <CheckCircleOutlined sx={{ fontSize: 18, color: 'success.main' }} />
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        Connection detected — first request received <RelativeTime value={live.lastUsedAt} />.
                      </Typography>
                    </>
                  ) : (
                    <>
                      <Typography variant="body2" color="text.secondary">
                        Waiting for the first request…
                      </Typography>
                      <Button size="small" variant="outlined" startIcon={<RefreshOutlined />} onClick={() => void tokens.refetch()} loading={tokens.isFetching}>
                        Check now
                      </Button>
                    </>
                  )}
                </Stack>
              </>
            ) : (
              <>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                  Sends a real request to the delivery API with your new key, exactly as your application will.
                </Typography>
                <Button variant="contained" onClick={() => void probe('/', setConnection)} loading={probing}>
                  {connection ? 'Test again' : 'Test connection'}
                </Button>
                <FormError error={probeError ? new Error(`The API could not be reached: ${errorMessage(probeError)}`) : null} />
                {connection && (
                  <Box sx={{ mt: 3 }}>
                    <ProbeResult probe={connection}>
                      {connection.ok ? (
                        <Typography variant="body2">
                          Connected to <b>{String((connection.body as { project?: string })?.project ?? ws.project.slug)}</b> ·{' '}
                          {String((connection.body as { environment?: string })?.environment ?? environment.key)} with{' '}
                          {String((connection.body as { access?: string })?.access ?? access)
                            .toLowerCase()
                            .replace('_', '-')}{' '}
                          access.
                        </Typography>
                      ) : (
                        <CodeBlock code={excerpt(connection.body)} language="json" />
                      )}
                    </ProbeResult>
                  </Box>
                )}
              </>
            )}
          </Box>
        );
      case 7:
        return (
          <Box sx={{ maxWidth: 820 }}>
            {secretKey ? (
              <>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                  Now fetch some content from your server. Successful requests made with this key are counted here.
                </Typography>
                <CodeBlock language="bash" code={curl(`/${ctx.type}?limit=1${access === 'PREVIEW' ? '&status=draft' : ''}`)} />
                <Stack direction="row" spacing={3} sx={{ mt: 3, alignItems: 'center' }}>
                  {contentOk ? (
                    <>
                      <CheckCircleOutlined sx={{ fontSize: 18, color: 'success.main' }} />
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        Content retrieved — {successes} successful request{successes === 1 ? '' : 's'} recorded for this key.
                      </Typography>
                    </>
                  ) : (
                    <>
                      <Typography variant="body2" color="text.secondary">
                        Waiting for a successful content request… (counts update within a few seconds)
                      </Typography>
                      <Button size="small" variant="outlined" startIcon={<RefreshOutlined />} onClick={() => void tokens.refetch()} loading={tokens.isFetching}>
                        Check now
                      </Button>
                    </>
                  )}
                </Stack>
              </>
            ) : (
              <>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                  Fetches one published {ctx.typeLabel.toLowerCase()} entry through the delivery API to prove content reaches your application.
                </Typography>
                <Button variant="contained" onClick={() => void probe(`/${ctx.type}?limit=1`, setContent)} loading={probing}>
                  {content ? 'Fetch again' : 'Verify content retrieval'}
                </Button>
                <FormError error={probeError ? new Error(`The API could not be reached: ${errorMessage(probeError)}`) : null} />
                {content && (
                  <Box sx={{ mt: 3 }}>
                    <ProbeResult probe={content}>
                      {content.ok && total === 0 ? (
                        <Alert severity="info">
                          The request works, but nothing is published in <b>{ctx.typeLabel}</b> yet. Publish an entry and it will be available here immediately — no redeploy needed.{' '}
                          <RouterLink to={ws.href(`content/${ctx.type}`)}>Open {ctx.typeLabel}</RouterLink>
                        </Alert>
                      ) : (
                        <>
                          {content.ok && (
                            <Typography variant="body2" sx={{ mb: 2 }}>
                              Retrieved <b>{total}</b> published {total === 1 ? 'entry' : 'entries'} from <Mono>{ctx.type}</Mono>. First result:
                            </Typography>
                          )}
                          <CodeBlock code={excerpt(content.ok ? firstItem : content.body)} language="json" maxHeight={280} />
                        </>
                      )}
                    </ProbeResult>
                  </Box>
                )}
              </>
            )}
          </Box>
        );
      default:
        return (
          <Box sx={{ maxWidth: 720 }}>
            <Stack direction="row" spacing={3} sx={{ alignItems: 'center', mb: 2 }}>
              <CheckCircleOutlined sx={{ fontSize: 28, color: 'success.main' }} />
              <Box>
                <Typography variant="h4" component="p">
                  {live?.name ?? credential?.token.name ?? 'Your application'} is connected
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  It now appears under connected applications. Anything published in {environment.name} is available to it on the next request.
                </Typography>
              </Box>
            </Stack>
            <Alert severity="info" sx={{ my: 4 }}>
              If your site caches pages or sits behind a CDN, add a webhook so it refreshes the moment content is published. Without one, visitors keep seeing the cached version
              until it expires.
            </Alert>
            <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 2 }}>
              <Button variant="contained" startIcon={<WebhookOutlined />} component={RouterLink} to={ws.hrefFor(ws.project, environment.key, 'dev/webhooks')}>
                Set up a webhook
              </Button>
              <Button variant="outlined" component={RouterLink} to={ws.href('dev/keys')}>
                Manage API keys
              </Button>
              <Button onClick={reset}>Connect another application</Button>
            </Stack>
          </Box>
        );
    }
  })();

  const navigation =
    active < 8 ? (
      <Stack direction="row" spacing={2} sx={{ mt: 5 }}>
        <Button startIcon={<ArrowBackOutlined />} onClick={() => setActive((s) => Math.max(0, s - 1))} disabled={active === 0}>
          Back
        </Button>
        <Button
          variant={active === 3 && !credential ? 'outlined' : 'contained'}
          endIcon={<ArrowForwardOutlined />}
          disabled={!canContinue}
          onClick={() => {
            setProbeError(null);
            if (active === 7) toast.success('Application marked as connected');
            setActive((s) => Math.min(8, s + 1));
          }}
        >
          {active === 7 ? 'Mark as connected' : 'Continue'}
        </Button>
      </Stack>
    ) : null;

  return (
    <Page>
      <PageHeader title="Integrations" description="Connect websites and apps to this project. Several applications can share one project, each with its own key." />

      <Section title="Connected applications" description="Applications are identified by the API key they use. A key is connected once it has called the API." flush sx={{ mb: 5 }}>
        {tokens.isLoading ? (
          <TableSkeleton rows={3} columns={5} />
        ) : tokens.isError ? (
          <ErrorState compact error={tokens.error} onRetry={() => void tokens.refetch()} />
        ) : connected.length === 0 ? (
          <EmptyState compact icon={<HubOutlined />} title="No application has connected yet" description="Follow the steps below to connect your first website or app. It takes a few minutes." />
        ) : (
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Application</TableCell>
                  <TableCell>Access</TableCell>
                  <TableCell>Environment</TableCell>
                  <TableCell>Last seen</TableCell>
                  <TableCell align="right">Requests · 7d</TableCell>
                  <TableCell>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {connected.map((token) => (
                  <TableRow key={token.id} hover>
                    <TableCell sx={{ maxWidth: 320 }}>
                      <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>
                        {token.name}
                      </Typography>
                      <Mono sx={{ color: 'text.secondary' }}>{token.prefix}…</Mono>
                    </TableCell>
                    <TableCell>
                      <TokenTypePill type={token.type} />
                    </TableCell>
                    <TableCell>
                      <EnvironmentLabel environmentId={token.environmentId} />
                    </TableCell>
                    <TableCell>
                      <RelativeTime value={token.lastUsedAt} />
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {compactNumber(token.requests7d)}
                    </TableCell>
                    <TableCell>
                      {isConnected(token) ? (
                        <Pill label="Connected" fg="success.dark" bg="success.light" dot />
                      ) : token.status === 'expired' ? (
                        <Pill label="Key expired" fg="warning.dark" bg="warning.light" dot />
                      ) : (
                        <Pill label="Idle" dot title="No requests in the last 30 days" />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Section>

      <Paper sx={{ borderRadius: '10px', p: { xs: 4, md: 6 } }}>
        <Typography variant="h4" component="h2">
          Connect an application
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 5 }}>
          A guided setup: choose your stack, get a key, copy working code and verify that content arrives.
        </Typography>
        {mobile ? (
          <Stepper activeStep={active} orientation="vertical">
            {STEPS.map((label, index) => (
              <Step key={label}>
                <StepLabel>{label}</StepLabel>
                <StepContent>
                  {index === active ? body : null}
                  {index === active ? navigation : null}
                </StepContent>
              </Step>
            ))}
          </Stepper>
        ) : (
          <>
            <Stepper activeStep={active} alternativeLabel>
              {STEPS.map((label) => (
                <Step key={label}>
                  <StepLabel>{label}</StepLabel>
                </Step>
              ))}
            </Stepper>
            <Box sx={{ mt: 6, pt: 5, borderTop: 1, borderColor: 'border.subtle' }}>
              <Typography variant="h5" component="h3" sx={{ mb: 3 }}>
                {active + 1}. {['Choose your framework', 'Choose the environment', 'Choose an access level', 'Generate credentials', 'Install and configure', 'Sample code', 'Test the connection', 'Verify content retrieval', 'Connected'][active]}
              </Typography>
              {body}
              {navigation}
            </Box>
          </>
        )}
      </Paper>
    </Page>
  );
}
