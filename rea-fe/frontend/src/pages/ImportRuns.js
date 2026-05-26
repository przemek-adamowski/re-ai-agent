import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import OfferDetailDialog from '../components/OfferDetailDialog';
import {
  fetchImportRuns,
  fetchImportRunEvents,
  fetchImportRunNewPending,
  getImportRun,
} from '../api';
import { chipToneSx, reviewStatusLabel } from '../offerStatus';

const stageLabelMap = {
  parse_list: 'Parse list',
  fetch_detail: 'Fetch detail',
  merge_detail: 'Merge detail',
  validate_before_sql: 'Validate',
  upsert_offer: 'Upsert',
  final_policy_state: 'Final policy',
  select_candidates: 'Select candidates',
  ai_rate: 'AI rate',
  update_offer_after_ai: 'Update after AI',
};

const toneByStatus = {
  completed: 'success',
  running: 'info',
  failed: 'error',
  stale: 'warning',
  aborted: 'default',
};

const eventColors = ['#1565c0', '#2e7d32', '#ed6c02', '#c62828', '#6a1b9a', '#546e7a'];

const fmtDate = (value) => (value ? new Date(value).toLocaleString('pl-PL') : '—');
const fmtNumber = (value) => (value == null ? '—' : Number(value).toLocaleString('pl-PL'));

function buildDropReasonData(metrics) {
  const totals = {};
  metrics.forEach((metric) => {
    const drops = metric.metadata?.drops || {};
    Object.entries(drops).forEach(([reason, count]) => {
      totals[reason] = (totals[reason] || 0) + Number(count || 0);
    });
  });
  return Object.entries(totals)
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
}

export default function ImportRuns() {
  const [eventsPage, setEventsPage] = useState(0);
  const [eventsPageSize, setEventsPageSize] = useState(25);
  const [runs, setRuns] = useState([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedRunId, setSelectedRunId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [events, setEvents] = useState([]);
  const [eventsTotal, setEventsTotal] = useState(0);
  const [newPending, setNewPending] = useState([]);
  const [triggerSource, setTriggerSource] = useState('schedule');
  const [stageFilter, setStageFilter] = useState('');
  const [eventTypeFilter, setEventTypeFilter] = useState('');
  const [detailTab, setDetailTab] = useState(0);
  const [selectedOfferId, setSelectedOfferId] = useState(null);
  const [offerDialogOpen, setOfferDialogOpen] = useState(false);

  const loadRuns = useCallback(async () => {
    setRunsLoading(true);
    setError('');
    try {
      const data = await fetchImportRuns({ limit: 50, trigger_source: triggerSource || undefined });
      setRuns(data);
      setSelectedRunId((previous) => {
        if (previous && data.some((item) => item.run_id === previous)) {
          return previous;
        }
        return data[0]?.run_id || null;
      });
    } catch (loadError) {
      setError(loadError.message || 'Failed to load import runs.');
      setRuns([]);
      setSelectedRunId(null);
    } finally {
      setRunsLoading(false);
    }
  }, [triggerSource]);

  const loadDetail = useCallback(async () => {
    if (!selectedRunId) {
      setDetail(null);
      setEvents([]);
      setEventsTotal(0);
      setNewPending([]);
      return;
    }

    setDetailLoading(true);
    setError('');
    try {
      const [runDetail, runEvents, pendingOffers] = await Promise.all([
        getImportRun(selectedRunId),
        fetchImportRunEvents(selectedRunId, {
          limit: eventsPageSize,
          offset: eventsPage * eventsPageSize,
          stage_key: stageFilter || undefined,
          event_type: eventTypeFilter || undefined,
        }),
        fetchImportRunNewPending(selectedRunId),
      ]);
      setDetail(runDetail);
      setEvents(runEvents.events || []);
      setEventsTotal(runEvents.total || 0);
      setNewPending(pendingOffers || []);
    } catch (loadError) {
      setError(loadError.message || 'Failed to load import run details.');
      setDetail(null);
      setEvents([]);
      setEventsTotal(0);
      setNewPending([]);
    } finally {
      setDetailLoading(false);
    }
  }, [selectedRunId, stageFilter, eventTypeFilter, eventsPage, eventsPageSize]);

  useEffect(() => {
    loadRuns();
  }, [loadRuns]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  useEffect(() => {
    setEventsPage(0);
  }, [selectedRunId, stageFilter, eventTypeFilter, eventsPageSize]);

  const funnelData = useMemo(() => (detail?.stage_metrics || []).map((metric) => ({
    stage_key: metric.stage_key,
    stage: stageLabelMap[metric.stage_key] || metric.stage_key,
    output_count: Number(metric.output_count || 0),
    dropped_count: Number(metric.dropped_count || 0),
    error_count: Number(metric.error_count || 0),
  })), [detail]);

  const dropReasonData = useMemo(() => buildDropReasonData(detail?.stage_metrics || []), [detail]);

  const summaryCards = useMemo(() => {
    const summary = detail?.run?.summary || {};
    return [
      { key: 'entered_workflow', label: 'Entered', value: summary.entered_workflow },
      { key: 'validated_for_sql', label: 'Validated', value: summary.validated_for_sql },
      { key: 'inserted_new', label: 'Inserted new', value: summary.inserted_new },
      { key: 'updated_existing', label: 'Updated', value: summary.updated_existing },
      { key: 'new_to_review', label: 'New to review', value: summary.new_to_review },
      { key: 'dropped_before_sql', label: 'Dropped', value: summary.dropped_before_sql },
    ];
  }, [detail]);

  const runRows = useMemo(() => runs.map((run) => ({
    ...run,
    entered_workflow: run.summary?.entered_workflow ?? 0,
    validated_for_sql: run.summary?.validated_for_sql ?? 0,
    inserted_new: run.summary?.inserted_new ?? 0,
    new_to_review: run.summary?.new_to_review ?? 0,
  })), [runs]);

  const runColumns = [
    { field: 'run_id', headerName: 'Run ID', flex: 1.6, minWidth: 260 },
    { field: 'started_at', headerName: 'Started', width: 180, valueFormatter: (params) => fmtDate(params.value) },
    { field: 'status', headerName: 'Status', width: 120, renderCell: (params) => <Chip size="small" label={params.value} sx={chipToneSx(toneByStatus[params.value] || 'default')} /> },
    { field: 'trigger_source', headerName: 'Source', width: 110 },
    { field: 'entered_workflow', headerName: 'Entered', width: 95, type: 'number' },
    { field: 'validated_for_sql', headerName: 'Validated', width: 95, type: 'number' },
    { field: 'inserted_new', headerName: 'New', width: 80, type: 'number' },
    { field: 'new_to_review', headerName: 'Review', width: 90, type: 'number' },
  ];

  const eventColumns = [
    { field: 'created_at', headerName: 'Created', width: 180, valueFormatter: (params) => fmtDate(params.value) },
    { field: 'stage_key', headerName: 'Stage', width: 160, valueGetter: (params) => stageLabelMap[params.row.stage_key] || params.row.stage_key },
    { field: 'event_type', headerName: 'Event', width: 120 },
    { field: 'event_reason', headerName: 'Reason', width: 150, valueFormatter: (params) => params.value || '—' },
    { field: 'external_id', headerName: 'Offer', width: 160 },
    { field: 'review_status', headerName: 'Review status', width: 130, valueFormatter: (params) => params.value || '—' },
    {
      field: 'payload',
      headerName: 'Payload',
      flex: 1,
      minWidth: 220,
      valueFormatter: (params) => JSON.stringify(params.value || {}),
    },
  ];

  const pendingColumns = [
    { field: 'external_id', headerName: 'Offer', width: 160 },
    { field: 'title', headerName: 'Title', flex: 1.6, minWidth: 260 },
    { field: 'district', headerName: 'District', width: 160 },
    { field: 'review_status', headerName: 'Run status', width: 130, renderCell: (params) => <Chip size="small" label={reviewStatusLabel(params.value)} sx={chipToneSx(params.value === 'pending' ? 'warning' : 'default')} /> },
    { field: 'current_review_status', headerName: 'Current status', width: 140, valueFormatter: (params) => reviewStatusLabel(params.value) },
    { field: 'price', headerName: 'Price', width: 120, valueFormatter: (params) => fmtNumber(params.value) },
  ];

  const stageOptions = useMemo(() => {
    const keys = new Set((detail?.stage_metrics || []).map((metric) => metric.stage_key));
    return Array.from(keys);
  }, [detail]);

  const eventTypeOptions = useMemo(() => {
    const keys = new Set((events || []).map((event) => event.event_type));
    return Array.from(keys);
  }, [events]);

  return (
    <Box>
      <Typography variant="h5" gutterBottom>Import runs</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Run-level telemetry for scheduled imports and backfills, including funnel metrics, drop reasons, detailed events, and new offers awaiting review.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Paper sx={{ p: 2, mb: 3 }}>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center', mb: 2 }}>
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>Trigger source</InputLabel>
            <Select value={triggerSource} onChange={(event) => setTriggerSource(event.target.value)} label="Trigger source">
              <MenuItem value="">All</MenuItem>
              <MenuItem value="schedule">Schedule</MenuItem>
              <MenuItem value="backfill">Backfill</MenuItem>
              <MenuItem value="manual_url">Manual URL</MenuItem>
              <MenuItem value="manual_replay">Manual replay</MenuItem>
            </Select>
          </FormControl>
          <Chip label={`${runs.length} runs loaded`} color="primary" variant="outlined" />
          {selectedRunId && <Chip label={`Selected: ${selectedRunId}`} variant="outlined" />}
        </Box>

        {runsLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
        ) : (
          <DataGrid
            rows={runRows}
            columns={runColumns}
            getRowId={(row) => row.run_id}
            autoHeight
            pagination
            initialState={{ pagination: { paginationModel: { page: 0, pageSize: 10 } } }}
            pageSizeOptions={[10]}
            disableRowSelectionOnClick
            onRowClick={(params) => setSelectedRunId(params.row.run_id)}
            sx={{ cursor: 'pointer', '& .MuiDataGrid-row:hover': { backgroundColor: 'action.hover' } }}
          />
        )}
      </Paper>

      {detailLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
      ) : !detail?.run ? (
        <Paper sx={{ p: 3 }}><Typography color="text.secondary">Select an import run to inspect its funnel and events.</Typography></Paper>
      ) : (
        <>
          <Grid container spacing={2} sx={{ mb: 3 }}>
            {summaryCards.map((card) => (
              <Grid item xs={6} md={2} key={card.key}>
                <Paper sx={{ p: 2 }}>
                  <Typography variant="caption" color="text.secondary">{card.label}</Typography>
                  <Typography variant="h5" fontWeight="bold">{fmtNumber(card.value)}</Typography>
                </Paper>
              </Grid>
            ))}
          </Grid>

          <Paper sx={{ p: 2, mb: 3 }}>
            <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
              <Chip label={detail.run.status} sx={chipToneSx(toneByStatus[detail.run.status] || 'default')} />
              <Chip label={`Source: ${detail.run.trigger_source}`} variant="outlined" />
              <Chip label={`Version: ${detail.run.workflow_version || '—'}`} variant="outlined" />
              <Chip label={`Started: ${fmtDate(detail.run.started_at)}`} variant="outlined" />
              <Chip label={`Finished: ${fmtDate(detail.run.finished_at)}`} variant="outlined" />
            </Box>
          </Paper>

          <Paper sx={{ p: 2 }}>
            <Tabs value={detailTab} onChange={(event, value) => setDetailTab(value)} sx={{ mb: 2 }}>
              <Tab label="Funnel" />
              <Tab label={`Events (${eventsTotal})`} />
              <Tab label={`New pending (${newPending.length})`} />
            </Tabs>

            {detailTab === 0 && (
              <Grid container spacing={3}>
                <Grid item xs={12} lg={8}>
                  <Paper variant="outlined" sx={{ p: 2, height: 360 }}>
                    <Typography variant="subtitle1" fontWeight="bold" gutterBottom>Stage funnel</Typography>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={funnelData} margin={{ top: 10, right: 10, left: 0, bottom: 40 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="stage" angle={-20} textAnchor="end" interval={0} height={70} />
                        <YAxis />
                        <RTooltip />
                        <Bar dataKey="output_count" name="Output" fill="#1565c0" />
                        <Bar dataKey="dropped_count" name="Dropped" fill="#c62828" />
                        <Bar dataKey="error_count" name="Errors" fill="#ed6c02" />
                      </BarChart>
                    </ResponsiveContainer>
                  </Paper>
                </Grid>
                <Grid item xs={12} lg={4}>
                  <Paper variant="outlined" sx={{ p: 2, height: 360 }}>
                    <Typography variant="subtitle1" fontWeight="bold" gutterBottom>Drop reasons</Typography>
                    {dropReasonData.length === 0 ? (
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                        <Typography color="text.secondary">No drop reasons recorded for this run.</Typography>
                      </Box>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={dropReasonData} dataKey="count" nameKey="reason" outerRadius={105} label>
                            {dropReasonData.map((entry, index) => (
                              <Cell key={entry.reason} fill={eventColors[index % eventColors.length]} />
                            ))}
                          </Pie>
                          <RTooltip />
                        </PieChart>
                      </ResponsiveContainer>
                    )}
                  </Paper>
                </Grid>
                <Grid item xs={12}>
                  <DataGrid
                    rows={detail.stage_metrics || []}
                    columns={[
                      { field: 'stage_order', headerName: '#', width: 70, type: 'number' },
                      { field: 'stage_key', headerName: 'Stage', flex: 1, minWidth: 180, valueGetter: (params) => stageLabelMap[params.row.stage_key] || params.row.stage_key },
                      { field: 'input_count', headerName: 'Input', width: 90, type: 'number' },
                      { field: 'output_count', headerName: 'Output', width: 90, type: 'number' },
                      { field: 'dropped_count', headerName: 'Dropped', width: 95, type: 'number' },
                      { field: 'error_count', headerName: 'Errors', width: 90, type: 'number' },
                      { field: 'duration_ms', headerName: 'Duration ms', width: 120, type: 'number', valueFormatter: (params) => fmtNumber(params.value) },
                      { field: 'metadata', headerName: 'Metadata', flex: 1.2, minWidth: 260, valueFormatter: (params) => JSON.stringify(params.value || {}) },
                    ]}
                    getRowId={(row) => `${row.run_id}-${row.stage_key}`}
                    autoHeight
                    hideFooter
                    disableRowSelectionOnClick
                  />
                </Grid>
              </Grid>
            )}

            {detailTab === 1 && (
              <>
                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center', mb: 2 }}>
                  <FormControl size="small" sx={{ minWidth: 180 }}>
                    <InputLabel>Stage</InputLabel>
                    <Select value={stageFilter} onChange={(event) => setStageFilter(event.target.value)} label="Stage">
                      <MenuItem value="">All stages</MenuItem>
                      {stageOptions.map((stageKey) => (
                        <MenuItem key={stageKey} value={stageKey}>{stageLabelMap[stageKey] || stageKey}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <FormControl size="small" sx={{ minWidth: 160 }}>
                    <InputLabel>Event type</InputLabel>
                    <Select value={eventTypeFilter} onChange={(event) => setEventTypeFilter(event.target.value)} label="Event type">
                      <MenuItem value="">All event types</MenuItem>
                      {eventTypeOptions.map((eventType) => (
                        <MenuItem key={eventType} value={eventType}>{eventType}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <Chip label={`${eventsTotal} events`} variant="outlined" />
                </Box>
                <DataGrid
                  rows={events}
                  columns={eventColumns}
                  getRowId={(row) => row.id}
                  autoHeight
                  pagination
                  paginationMode="server"
                  rowCount={eventsTotal}
                  paginationModel={{ page: eventsPage, pageSize: eventsPageSize }}
                  onPaginationModelChange={(model) => {
                    if (model.page !== eventsPage) {
                      setEventsPage(model.page);
                    }
                    if (model.pageSize !== eventsPageSize) {
                      setEventsPageSize(model.pageSize);
                    }
                  }}
                  pageSizeOptions={[10, 25, 50, 100]}
                  disableRowSelectionOnClick
                  sx={{ '& .MuiDataGrid-cell': { alignItems: 'flex-start' } }}
                />
              </>
            )}

            {detailTab === 2 && (
              <DataGrid
                rows={newPending}
                columns={pendingColumns}
                getRowId={(row) => row.external_id}
                autoHeight
                hideFooter
                disableRowSelectionOnClick
                onRowClick={(params) => {
                  setSelectedOfferId(params.row.external_id);
                  setOfferDialogOpen(true);
                }}
                sx={{ cursor: 'pointer', '& .MuiDataGrid-row:hover': { backgroundColor: 'action.hover' } }}
              />
            )}
          </Paper>
        </>
      )}

      <OfferDetailDialog
        offerId={selectedOfferId}
        open={offerDialogOpen}
        onClose={() => setOfferDialogOpen(false)}
        onUpdated={() => loadDetail()}
      />
    </Box>
  );
}
