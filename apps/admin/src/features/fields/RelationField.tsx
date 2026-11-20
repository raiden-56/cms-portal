import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useSchema, useWorkspace } from '@/app/workspace';
import { StatusChip, useDebounced } from '@/components/ui';
import { api } from '@/lib/api';
import type { RelationOption } from '@/lib/types';

/**
 * Picks one or many entries of another content type. Values are document ids, so a link
 * stays valid across locales and survives edits to the target entry.
 */
export function RelationField({
  targetType,
  multiple,
  value,
  onChange,
  disabled,
  invalid,
  placeholder,
}: {
  targetType: string | undefined;
  multiple: boolean;
  value: unknown;
  onChange: (value: string | string[] | null) => void;
  disabled?: boolean;
  invalid?: boolean;
  placeholder?: string;
}) {
  const { environment, envBase } = useWorkspace();
  const schema = useSchema();
  const type = schema.data?.types.find((t) => t.apiId === targetType);
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const term = useDebounced(input, 220);
  const ids = useMemo(() => (multiple ? (Array.isArray(value) ? (value as string[]) : []) : typeof value === 'string' && value ? [value] : []), [value, multiple]);

  // Titles of the entries already selected.
  const selected = useQuery({
    queryKey: ['relation-selected', environment?.id, targetType, [...ids].sort().join(',')],
    queryFn: () => api.get<{ items: RelationOption[] }>(`${envBase}/relation-options/${targetType}`, { ids: ids.join(',') }).then((r) => r.items),
    enabled: !!environment && !!targetType && ids.length > 0,
    placeholderData: keepPreviousData,
  });
  const options = useQuery({
    queryKey: ['relation-options', environment?.id, targetType, term],
    queryFn: () => api.get<{ items: RelationOption[] }>(`${envBase}/relation-options/${targetType}`, { search: term }).then((r) => r.items),
    enabled: !!environment && !!targetType && open,
    placeholderData: keepPreviousData,
  });

  const byId = useMemo(() => new Map([...(options.data ?? []), ...(selected.data ?? [])].map((o) => [o.id, o])), [options.data, selected.data]);
  const resolve = (id: string): RelationOption => byId.get(id) ?? { id, entryId: '', title: selected.isLoading ? 'Loading…' : 'Deleted entry', status: 'DRAFT', isPublished: false };
  const current = ids.map(resolve);

  if (!targetType || (schema.data && !type)) {
    return (
      <Typography variant="body2" color="error">
        This field links to a content type that no longer exists. Update it in the content type builder.
      </Typography>
    );
  }

  const common = {
    options: options.data ?? [],
    loading: options.isFetching,
    disabled,
    open,
    onOpen: () => setOpen(true),
    onClose: () => setOpen(false),
    // Results come from the server already filtered by the search term.
    filterOptions: (x: RelationOption[]) => x,
    getOptionLabel: (o: RelationOption) => o.title,
    isOptionEqualToValue: (a: RelationOption, b: RelationOption) => a.id === b.id,
    inputValue: input,
    noOptionsText: term ? 'No entries match' : `No ${type?.pluralName.toLowerCase() ?? 'entries'} yet`,
    renderOption: (props: React.HTMLAttributes<HTMLLIElement> & { key?: React.Key }, option: RelationOption) => {
      const { key, ...rest } = props;
      return (
        <Box component="li" key={key ?? option.id} {...rest} sx={{ display: 'flex', gap: 2, justifyContent: 'space-between' }}>
          <Typography variant="body2" noWrap sx={{ flex: 1 }}>
            {option.title}
          </Typography>
          <StatusChip status={option.status} isPublished={option.isPublished} />
        </Box>
      );
    },
  };
  const renderInput = (params: object) => (
    <TextField
      {...params}
      error={invalid}
      placeholder={current.length ? undefined : (placeholder ?? `Search ${type?.pluralName.toLowerCase() ?? 'entries'}…`)}
      slotProps={{
        input: {
          ...(params as { InputProps: object }).InputProps,
          endAdornment: (
            <>
              {options.isFetching && open ? <CircularProgress color="inherit" size={14} /> : null}
              {(params as { InputProps: { endAdornment: React.ReactNode } }).InputProps.endAdornment}
            </>
          ),
        },
      }}
    />
  );

  return multiple ? (
    <Autocomplete<RelationOption, true>
      {...common}
      multiple
      value={current}
      onInputChange={(_, next) => setInput(next)}
      onChange={(_, next) => onChange(next.map((o) => o.id))}
      renderValue={(values, getItemProps) =>
        values.map((option, index) => {
          const { key, ...item } = getItemProps({ index });
          return <Chip key={key} {...item} label={option.title} variant="outlined" sx={{ maxWidth: 220 }} />;
        })
      }
      renderInput={renderInput}
    />
  ) : (
    <Autocomplete<RelationOption, false>
      {...common}
      value={current[0] ?? null}
      onInputChange={(_, next) => setInput(next)}
      onChange={(_, next) => onChange(next?.id ?? null)}
      renderInput={renderInput}
    />
  );
}
