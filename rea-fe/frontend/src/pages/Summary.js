import React, { useState, useEffect, useCallback } from 'react';
import {
  Grid, Typography, Box, FormControl, InputLabel, Select, MenuItem,
  TextField, CircularProgress, Paper, Chip,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import { fetchOffers, fetchStats, fetchCategories } from '../api';
import OfferDetailDialog from '../components/OfferDetailDialog';

const PIE_COLORS = { like: '#4caf50', dislike: '#f44336', pending: '#ff9800', unknown: '#9e9e9e' };
const fmt = (p) => !p ? '\u2014' : new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 0 }).format(p);

const columns = [
  { field: 'title', headerName: 'Title', flex: 2, minWidth: 200 },
  { field: 'category', headerName: 'Category', width: 160 },
  { field: 'price', headerName: 'Price (PLN)', width: 140, type: 'number', valueFormatter: (params) => fmt(params.value) },
  { field: 'price_per_m2', headerName: 'PLN/m\u00B2', width: 120, type: 'number',
    valueFormatter: (params) => params.value ? Math.round(params.value).toLocaleString('pl-PL') : '\u2014' },
  { field: 'area', headerName: 'Area (m\u00B2)', width: 100, type: 'number' },
  { field: 'ai_rating', headerName: 'AI', width: 70, type: 'number' },
  { field: 'user_rating', headerName: 'Status', width: 100,
    renderCell: (params) => {
      const c = { like: 'success', dislike: 'error', pending: 'warning' }[params.value] || 'default';
      return <Chip label={params.value} size="small" color={c} />;
    }},
  { field: 'url', headerName: 'Link', width: 70, sortable: false,
    renderCell: (params) => <a href={params.value} target="_blank" rel="noopener noreferrer">Open</a> },
];

export default function Summary() {
  const [stats, setStats] = useState(null);
  const [offers, setOffers] = useState([]);
  const [total, setTotal] = useState(0);
  const [categories, setCats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selId, setSelId] = useState(null);
  const [dlgOpen, setDlgOpen] = useState(false);
  const [userRating, setUserRating] = useState('');
  const [category, setCategory] = useState('');
  const [priceMin, setPriceMin] = useState('');
  const [priceMax, setPriceMax] = useState('');
  const [areaMin, setAreaMin] = useState('');
  const [areaMax, setAreaMax] = useState('');
  const [aiMin, setAiMin] = useState('');
  const [aiMax, setAiMax] = useState('');

  const fp = useCallback(() => ({
    user_rating: userRating || undefined, category: category || undefined,
    price_min: priceMin ? Number(priceMin) : undefined, price_max: priceMax ? Number(priceMax) : undefined,
    area_min: areaMin ? Number(areaMin) : undefined, area_max: areaMax ? Number(areaMax) : undefined,
    ai_rating_min: aiMin ? Number(aiMin) : undefined, ai_rating_max: aiMax ? Number(aiMax) : undefined,
  }), [userRating, category, priceMin, priceMax, areaMin, areaMax, aiMin, aiMax]);

  const load = useCallback(async () => {
    setLoading(true);
    const p = fp();
    const [s, o] = await Promise.all([fetchStats(p), fetchOffers({ ...p, limit: 10000 })]);
    setStats(s); setOffers(o.offers); setTotal(o.total); setLoading(false);
  }, [fp]);

  useEffect(() => { fetchCategories().then(setCats); }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <Box>
      <Typography variant="h5" gutterBottom>Summary &amp; Analytics</Typography>
      <Paper sx={{ p: 2, mb: 3 }}>
        <Typography variant="subtitle2" gutterBottom>Filters</Typography>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <FormControl size="small" sx={{ minWidth: 130 }}>
            <InputLabel>Status</InputLabel>
            <Select value={userRating} onChange={(e) => setUserRating(e.target.value)} label="Status">
              <MenuItem value="">All</MenuItem>
              <MenuItem value="pending">Pending</MenuItem>
              <MenuItem value="like">Liked</MenuItem>
              <MenuItem value="dislike">Disliked</MenuItem>
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel>Category</InputLabel>
            <Select value={category} onChange={(e) => setCategory(e.target.value)} label="Category">
              <MenuItem value="">All</MenuItem>
              {categories.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
            </Select>
          </FormControl>
          <TextField size="small" label="Price min" type="number" value={priceMin} onChange={(e) => setPriceMin(e.target.value)} sx={{ width: 120 }} />
          <TextField size="small" label="Price max" type="number" value={priceMax} onChange={(e) => setPriceMax(e.target.value)} sx={{ width: 120 }} />
          <TextField size="small" label="Area min" type="number" value={areaMin} onChange={(e) => setAreaMin(e.target.value)} sx={{ width: 100 }} />
          <TextField size="small" label="Area max" type="number" value={areaMax} onChange={(e) => setAreaMax(e.target.value)} sx={{ width: 100 }} />
          <TextField size="small" label="AI min" type="number" value={aiMin} onChange={(e) => setAiMin(e.target.value)} sx={{ width: 80 }} />
          <TextField size="small" label="AI max" type="number" value={aiMax} onChange={(e) => setAiMax(e.target.value)} sx={{ width: 80 }} />
          <Chip label={`${total} offers`} color="primary" variant="outlined" />
        </Box>
      </Paper>
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
      ) : stats && (
        <>
          <Grid container spacing={3} sx={{ mb: 3 }}>
            <Grid item xs={12} md={6}>
              <Paper sx={{ p: 2 }}>
                <Typography variant="subtitle1" fontWeight="bold" gutterBottom>Price Distribution</Typography>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={stats.price_histogram}>
                    <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="range" fontSize={12} /><YAxis />
                    <RTooltip /><Bar dataKey="count" fill="#1976d2" />
                  </BarChart>
                </ResponsiveContainer>
              </Paper>
            </Grid>
            <Grid item xs={12} md={6}>
              <Paper sx={{ p: 2 }}>
                <Typography variant="subtitle1" fontWeight="bold" gutterBottom>Avg Price/m&sup2; by Category</Typography>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={stats.price_per_m2_by_category}>
                    <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="category" fontSize={11} /><YAxis />
                    <RTooltip formatter={(v) => `${Math.round(v).toLocaleString('pl-PL')} PLN`} />
                    <Bar dataKey="avg" fill="#ff9800" name="Avg PLN/m&sup2;" />
                  </BarChart>
                </ResponsiveContainer>
              </Paper>
            </Grid>
            <Grid item xs={12} md={6}>
              <Paper sx={{ p: 2 }}>
                <Typography variant="subtitle1" fontWeight="bold" gutterBottom>AI Rating Distribution</Typography>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={stats.ai_rating_distribution}>
                    <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="rating" /><YAxis />
                    <RTooltip /><Bar dataKey="count" fill="#4caf50" />
                  </BarChart>
                </ResponsiveContainer>
              </Paper>
            </Grid>
            <Grid item xs={12} md={6}>
              <Paper sx={{ p: 2 }}>
                <Typography variant="subtitle1" fontWeight="bold" gutterBottom>User Rating Breakdown</Typography>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie data={stats.user_rating_breakdown} dataKey="count" nameKey="status"
                      cx="50%" cy="50%" outerRadius={100}
                      label={({ status, count }) => `${status}: ${count}`}>
                      {stats.user_rating_breakdown.map((e) => (
                        <Cell key={e.status} fill={PIE_COLORS[e.status] || '#9e9e9e'} />
                      ))}
                    </Pie>
                    <RTooltip /><Legend />
                  </PieChart>
                </ResponsiveContainer>
              </Paper>
            </Grid>
          </Grid>
          <Paper sx={{ p: 2 }}>
            <Typography variant="subtitle1" fontWeight="bold" gutterBottom>All Offers</Typography>
            <DataGrid rows={offers} columns={columns} getRowId={(r) => r.external_id}
              initialState={{ pagination: { paginationModel: { pageSize: 25 } },
                sorting: { sortModel: [{ field: 'price', sort: 'asc' }] } }}
              pageSizeOptions={[10, 25, 50, 100]}
              onRowClick={(p) => { setSelId(p.row.external_id); setDlgOpen(true); }}
              sx={{ cursor: 'pointer', '& .MuiDataGrid-row:hover': { backgroundColor: 'action.hover' } }}
              autoHeight disableRowSelectionOnClick />
          </Paper>
        </>
      )}
      <OfferDetailDialog offerId={selId} open={dlgOpen}
        onClose={() => setDlgOpen(false)} onUpdated={() => load()} />
    </Box>
  );
}
