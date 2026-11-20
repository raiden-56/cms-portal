import { type ReactNode, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import InputBase from '@mui/material/InputBase';
import ListItemIcon from '@mui/material/ListItemIcon';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Popover from '@mui/material/Popover';
import Stack from '@mui/material/Stack';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ArchiveOutlined from '@mui/icons-material/ArchiveOutlined';
import ArrowBackOutlined from '@mui/icons-material/ArrowBackOutlined';
import CheckOutlined from '@mui/icons-material/CheckOutlined';
import CloudDoneOutlined from '@mui/icons-material/CloudDoneOutlined';
import CloudOffOutlined from '@mui/icons-material/CloudOffOutlined';
import DesktopWindowsOutlined from '@mui/icons-material/DesktopWindowsOutlined';
import ErrorOutlineOutlined from '@mui/icons-material/ErrorOutlineOutlined';
import EventOutlined from '@mui/icons-material/EventOutlined';
import ExpandMoreOutlined from '@mui/icons-material/ExpandMoreOutlined';
import HistoryOutlined from '@mui/icons-material/HistoryOutlined';
import LinkOutlined from '@mui/icons-material/LinkOutlined';
import MoreHorizOutlined from '@mui/icons-material/MoreHorizOutlined';
import OpenInNewOutlined from '@mui/icons-material/OpenInNewOutlined';
import PhoneIphoneOutlined from '@mui/icons-material/PhoneIphoneOutlined';
import PublicOffOutlined from '@mui/icons-material/PublicOffOutlined';
import PublicOutlined from '@mui/icons-material/PublicOutlined';
import RateReviewOutlined from '@mui/icons-material/RateReviewOutlined';
import RedoOutlined from '@mui/icons-material/RedoOutlined';
import SendOutlined from '@mui/icons-material/SendOutlined';
import SettingsOutlined from '@mui/icons-material/SettingsOutlined';
import TabletMacOutlined from '@mui/icons-material/TabletMacOutlined';
import TuneOutlined from '@mui/icons-material/TuneOutlined';
import UnarchiveOutlined from '@mui/icons-material/UnarchiveOutlined';
import UndoOutlined from '@mui/icons-material/UndoOutlined';
import UndoRounded from '@mui/icons-material/UndoRounded';
import ViewSidebarOutlined from '@mui/icons-material/ViewSidebarOutlined';
import type { WorkflowAction } from '@meridian/shared';
import { StatusChip } from '@/components/ui';
import { fullDateTime } from '@/lib/format';
import type { EntryDetail } from '@/lib/types';
import type { PublishIssue } from './dnd';
import type { Device } from './editorSlice';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export interface ToolbarProps {
  backHref: string;
  title: string;
  titleInvalid: boolean;
  onTitle: (title: string) => void;
  entry: EntryDetail;
  dirty: boolean;
  saveState: SaveState;
  readOnly: boolean;
  readOnlyReason: string;
  can: { update: boolean; publish: boolean; review: boolean };
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  device: Device;
  onDevice: (device: Device) => void;
  leftOpen: boolean;
  rightOpen: boolean;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  issues: PublishIssue[];
  onIssue: (issue: PublishIssue) => void;
  saving: boolean;
  publishing: boolean;
  onSave: () => void;
  onPublish: () => void;
  onPreviewDraft: () => void;
  onCopyPreviewLink: () => void;
  onDeliveryInfo: () => void;
  onUnpublish: () => void;
  onSchedule: () => void;
  onTransition: (action: WorkflowAction) => void;
  onVersions: () => void;
  onPageSettings: () => void;
}

function IconTool({ label, onClick, disabled, active, children }: { label: string; onClick: () => void; disabled?: boolean; active?: boolean; children: ReactNode }) {
  return (
    <Tooltip title={label}>
      <span>
        <IconButton size="small" aria-label={label} aria-pressed={active} disabled={disabled} onClick={onClick} sx={active ? { color: 'secondary.main', bgcolor: 'action.selected' } : undefined}>
          {children}
        </IconButton>
      </span>
    </Tooltip>
  );
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? '⌘' : 'Ctrl+';

/** Slim top bar of the page editor: identity and state on the left, view controls in the middle, actions on the right. */
export function Toolbar(p: ToolbarProps) {
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [previewMenu, setPreviewMenu] = useState<HTMLElement | null>(null);
  const [issuesAnchor, setIssuesAnchor] = useState<HTMLElement | null>(null);
  const { entry } = p;
  const status = entry.status;
  const archived = status === 'ARCHIVED';

  const indicator = p.readOnly ? (
    <Tooltip title={p.readOnlyReason}>
      <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
        Read only
      </Typography>
    </Tooltip>
  ) : p.saveState === 'saving' ? (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', color: 'text.secondary' }}>
      <CircularProgress size={12} thickness={5} color="inherit" />
      <Typography variant="caption" sx={{ whiteSpace: 'nowrap' }}>
        Saving…
      </Typography>
    </Stack>
  ) : p.saveState === 'error' && p.dirty ? (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', color: 'error.main' }}>
      <CloudOffOutlined sx={{ fontSize: 15 }} />
      <Typography variant="caption" sx={{ whiteSpace: 'nowrap' }}>
        Not saved
      </Typography>
    </Stack>
  ) : p.dirty ? (
    <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
      Unsaved changes
    </Typography>
  ) : (
    <Tooltip title={`Last saved ${fullDateTime(entry.updatedAt)}`}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', color: 'text.disabled' }}>
        <CloudDoneOutlined sx={{ fontSize: 15 }} />
        <Typography variant="caption" sx={{ whiteSpace: 'nowrap', display: { xs: 'none', lg: 'inline' } }}>
          Saved
        </Typography>
      </Stack>
    </Tooltip>
  );

  const workflow: { action: WorkflowAction; label: string; icon: ReactNode; show: boolean }[] = [
    { action: 'submit', label: 'Submit for review', icon: <SendOutlined />, show: p.can.update && (status === 'DRAFT' || status === 'CHANGES_REQUESTED') },
    { action: 'withdraw', label: 'Withdraw from review', icon: <UndoRounded />, show: p.can.update && status === 'IN_REVIEW' },
    { action: 'approve', label: 'Approve', icon: <CheckOutlined />, show: p.can.review && status === 'IN_REVIEW' },
    { action: 'request_changes', label: 'Request changes…', icon: <RateReviewOutlined />, show: p.can.review && (status === 'IN_REVIEW' || status === 'APPROVED') },
  ];
  const closeMenu = () => setMenu(null);

  return (
    <Box
      component="header"
      role="toolbar"
      aria-label="Page editor"
      sx={{ height: 48, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 2, px: 2.5, borderBottom: 1, borderColor: 'border.subtle', bgcolor: 'background.paper', overflowX: 'auto', overflowY: 'hidden' }}
    >
      <Tooltip title="Back to pages">
        <IconButton size="small" component={RouterLink} to={p.backHref} aria-label="Back to pages">
          <ArrowBackOutlined />
        </IconButton>
      </Tooltip>
      <IconTool label={p.leftOpen ? 'Hide blocks panel' : 'Show blocks panel'} active={p.leftOpen} onClick={p.onToggleLeft}>
        <ViewSidebarOutlined sx={{ transform: 'scaleX(-1)' }} />
      </IconTool>
      <Divider orientation="vertical" flexItem sx={{ my: 2.5 }} />

      <InputBase
        value={p.title}
        onChange={(e) => p.onTitle(e.target.value)}
        readOnly={p.readOnly}
        placeholder="Untitled page"
        slotProps={{ input: { 'aria-label': 'Page title', maxLength: 200, 'aria-invalid': p.titleInvalid } }}
        sx={{
          flex: '1 1 160px',
          minWidth: 120,
          maxWidth: 360,
          fontSize: '0.875rem',
          fontWeight: 600,
          px: 2,
          height: 32,
          borderRadius: '7px',
          border: 1,
          borderColor: p.titleInvalid ? 'error.main' : 'transparent',
          transition: 'border-color 120ms, background-color 120ms',
          '&:hover': p.readOnly ? undefined : { bgcolor: 'action.hover' },
          '&.Mui-focused': { borderColor: p.titleInvalid ? 'error.main' : 'secondary.main', bgcolor: 'background.paper' },
        }}
      />
      <Box sx={{ flexShrink: 0 }}>
        <StatusChip status={status} isPublished={entry.isPublished} hasChanges={entry.hasChanges || (entry.isPublished && p.dirty)} />
      </Box>
      <Box sx={{ flexShrink: 0 }}>{indicator}</Box>

      <Box sx={{ flex: 1 }} />

      <Stack direction="row" spacing={0.5} sx={{ flexShrink: 0 }}>
        <IconTool label={`Undo (${mod}Z)`} disabled={!p.canUndo || p.readOnly} onClick={p.onUndo}>
          <UndoOutlined />
        </IconTool>
        <IconTool label={`Redo (${mod}${isMac ? '⇧Z' : 'Shift+Z'})`} disabled={!p.canRedo || p.readOnly} onClick={p.onRedo}>
          <RedoOutlined />
        </IconTool>
      </Stack>
      <ToggleButtonGroup exclusive size="small" value={p.device} onChange={(_, next: Device | null) => next && p.onDevice(next)} aria-label="Preview device" sx={{ flexShrink: 0, '& .MuiToggleButton-root': { px: 2, py: 1 } }}>
        <ToggleButton value="desktop" aria-label="Desktop preview">
          <Tooltip title="Desktop">
            <DesktopWindowsOutlined sx={{ fontSize: 16 }} />
          </Tooltip>
        </ToggleButton>
        <ToggleButton value="tablet" aria-label="Tablet preview">
          <Tooltip title="Tablet · 820px">
            <TabletMacOutlined sx={{ fontSize: 16 }} />
          </Tooltip>
        </ToggleButton>
        <ToggleButton value="mobile" aria-label="Mobile preview">
          <Tooltip title="Mobile · 390px">
            <PhoneIphoneOutlined sx={{ fontSize: 16 }} />
          </Tooltip>
        </ToggleButton>
      </ToggleButtonGroup>

      <Box sx={{ flex: 1 }} />

      {p.issues.length > 0 && (
        <>
          <ButtonBase
            onClick={(e) => setIssuesAnchor(e.currentTarget)}
            aria-haspopup="dialog"
            sx={{ flexShrink: 0, height: 28, px: 2, gap: 1.5, borderRadius: '7px', bgcolor: 'error.light', color: 'error.dark', fontSize: '0.75rem', fontWeight: 600, whiteSpace: 'nowrap' }}
          >
            <ErrorOutlineOutlined sx={{ fontSize: 15 }} />
            {p.issues.length} to fix
          </ButtonBase>
          <Popover
            open={!!issuesAnchor}
            anchorEl={issuesAnchor}
            onClose={() => setIssuesAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            slotProps={{ paper: { sx: { width: 340, maxHeight: 400, mt: 1, borderRadius: '10px' } } }}
          >
            <Typography variant="h6" sx={{ px: 3.5, py: 2.5, borderBottom: 1, borderColor: 'border.subtle' }}>
              Fix these before publishing
            </Typography>
            <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 1.5 }}>
              {p.issues.map((issue, i) => (
                <Box component="li" key={i}>
                  <ButtonBase
                    onClick={() => {
                      p.onIssue(issue);
                      setIssuesAnchor(null);
                    }}
                    sx={{ width: '100%', display: 'block', textAlign: 'left', px: 2.5, py: 2, borderRadius: '7px', '&:hover': { bgcolor: 'action.hover' } }}
                  >
                    <Typography variant="caption" color="text.secondary" component="div">
                      {issue.label}
                    </Typography>
                    <Typography variant="body2">{issue.message}</Typography>
                  </ButtonBase>
                </Box>
              ))}
            </Box>
          </Popover>
        </>
      )}

      <Button size="small" onClick={(e) => setPreviewMenu(e.currentTarget)} endIcon={<ExpandMoreOutlined />} aria-haspopup="menu" sx={{ flexShrink: 0 }}>
        Preview
      </Button>
      <Menu anchorEl={previewMenu} open={!!previewMenu} onClose={() => setPreviewMenu(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
        <MenuItem
          onClick={() => {
            setPreviewMenu(null);
            p.onPreviewDraft();
          }}
        >
          <ListItemIcon>
            <OpenInNewOutlined />
          </ListItemIcon>
          Preview draft in a new tab
        </MenuItem>
        <MenuItem
          onClick={() => {
            setPreviewMenu(null);
            p.onCopyPreviewLink();
          }}
        >
          <ListItemIcon>
            <LinkOutlined />
          </ListItemIcon>
          Copy draft preview link
        </MenuItem>
        <Divider sx={{ my: 1 }} />
        <MenuItem
          onClick={() => {
            setPreviewMenu(null);
            p.onDeliveryInfo();
          }}
        >
          <ListItemIcon>
            <PublicOutlined />
          </ListItemIcon>
          Published version in the API…
        </MenuItem>
      </Menu>

      {!p.readOnly && (
        <Tooltip title={`Save (${mod}S)`}>
          <span>
            <Button size="small" variant="outlined" onClick={p.onSave} loading={p.saving} disabled={!p.dirty} sx={{ flexShrink: 0 }}>
              Save
            </Button>
          </span>
        </Tooltip>
      )}
      {p.can.publish && !archived && (
        <Tooltip title={entry.requiresApproval && status !== 'APPROVED' && !(entry.isPublished && !entry.hasChanges && !p.dirty) ? 'Pages need approval before publishing' : ''}>
          <span>
            <Button size="small" variant="contained" onClick={p.onPublish} loading={p.publishing} disabled={entry.isPublished && !entry.hasChanges && !p.dirty && status === 'PUBLISHED'} sx={{ flexShrink: 0 }}>
              {entry.isPublished ? 'Publish changes' : 'Publish'}
            </Button>
          </span>
        </Tooltip>
      )}

      <IconTool label={p.rightOpen ? 'Hide inspector' : 'Show inspector'} active={p.rightOpen} onClick={p.onToggleRight}>
        <TuneOutlined />
      </IconTool>
      <Tooltip title="More actions">
        <IconButton size="small" aria-label="More actions" aria-haspopup="menu" onClick={(e) => setMenu(e.currentTarget)}>
          <MoreHorizOutlined />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={menu} open={!!menu} onClose={closeMenu} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }} slotProps={{ paper: { sx: { minWidth: 230 } } }}>
        {workflow
          .filter((w) => w.show && !archived)
          .map((w) => (
            <MenuItem
              key={w.action}
              onClick={() => {
                closeMenu();
                p.onTransition(w.action);
              }}
            >
              <ListItemIcon>{w.icon}</ListItemIcon>
              {w.label}
            </MenuItem>
          ))}
        {workflow.some((w) => w.show && !archived) && <Divider sx={{ my: 1 }} />}
        {p.can.publish && !archived && (
          <MenuItem
            onClick={() => {
              closeMenu();
              p.onSchedule();
            }}
          >
            <ListItemIcon>
              <EventOutlined />
            </ListItemIcon>
            {entry.scheduledPublishAt || entry.scheduledUnpublishAt ? 'Edit schedule…' : 'Schedule…'}
          </MenuItem>
        )}
        {p.can.publish && entry.isPublished && (
          <MenuItem
            onClick={() => {
              closeMenu();
              p.onUnpublish();
            }}
          >
            <ListItemIcon>
              <PublicOffOutlined />
            </ListItemIcon>
            Unpublish
          </MenuItem>
        )}
        <MenuItem
          onClick={() => {
            closeMenu();
            p.onVersions();
          }}
        >
          <ListItemIcon>
            <HistoryOutlined />
          </ListItemIcon>
          Version history
          <Typography variant="caption" color="text.disabled" sx={{ ml: 'auto', pl: 3 }}>
            {entry.versionCount}
          </Typography>
        </MenuItem>
        <MenuItem
          onClick={() => {
            closeMenu();
            p.onPageSettings();
          }}
        >
          <ListItemIcon>
            <SettingsOutlined />
          </ListItemIcon>
          Page settings and SEO
        </MenuItem>
        {((p.can.publish && !archived) || (p.can.update && archived)) && <Divider sx={{ my: 1 }} />}
        {p.can.publish && !archived && (
          <MenuItem
            onClick={() => {
              closeMenu();
              p.onTransition('archive');
            }}
          >
            <ListItemIcon>
              <ArchiveOutlined />
            </ListItemIcon>
            Archive
          </MenuItem>
        )}
        {p.can.update && archived && (
          <MenuItem
            onClick={() => {
              closeMenu();
              p.onTransition('unarchive');
            }}
          >
            <ListItemIcon>
              <UnarchiveOutlined />
            </ListItemIcon>
            Restore from archive
          </MenuItem>
        )}
      </Menu>
    </Box>
  );
}
