import React, { useState, useEffect, useCallback } from 'react';
import {
  Grid, Typography, Box, FormControl, InputLabel, Select, MenuItem,
  CircularProgress, Pagination, Chip,
} from '@mui/material';
import OfferCard from '../components/OfferCard';
import OfferDetailDialog from '../components/OfferDetailDialog';
import { fetchOffers, updateOffer, fetchCategories } from '../api';

const PER_PAGE = 12;

export default function OfferAssessment() {
  const [offers, setOffers] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState([]);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState(null);
  const [dlgOpen, setDlgOpen] = useState(false);
  const [userRating, setUserRating] = useState('pending');
  const [category, setCategory] = useState('');
  const [sortBy, setSortBy] = useState('created_at');
  const [sortDir, setSortDir] = useState('desc');

  const load = useCallback(async () => {
    setLoading(true);
    const data = await fetchOffers({
      user_rating: userRating || undefined, category: category || undefined,
      sort_by: sortBy, sort_dir: sortDir, limit: PER_PAGE, offset: (page - 1) * PER_PAGE,
    });
    setOffers(data.offers);
    setTotal(data.total);
    setLoading(false);
  }, [userRating, category, sortBy, sortDir, page]);

  useEffect(() => { fetchCategories().then(setCategories); }, []);
  useEffect(() => { load(); }, [load]);

  const handleRate = async (id, r) => { await updateOffer(id, { user_rating: r }); load(); };
  const totalPages = Math.ceil(total / PER_PAGE);

  return (
    <Box>
      <Typography variant="h5" gutterBottom>Offer Assessment</Typography>
      <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap', alignItems: 'center' }}>
        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel>Status</InputLabel>
          <Select value={userRating} onChange={(e) => { setUserRating(e.target.value); setPage(1); }} label="Status">
            <MenuItem value="">All</MenuItem>
            <MenuItem value="pending">Pending</MenuItem>
            <MenuItem value="like">Liked</MenuItem>
            <MenuItem value="dislike">Disliked</MenuItem>
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <InputLabel>Category</InputLabel>
          <Select value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }} label="Category">
            <MenuItem value="">All categories</MenuItem>
            {categories.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel>Sort by</InputLabel>
          <Select value={sortBy} onChange={(e) => setSortBy(e.target.value)} label="Sort by">
            <MenuItem value="created_at">Date added</MenuItem>
            <MenuItem value="price">Price</MenuItem>
            <MenuItem value="price_per_m2">Price/m&sup2;</MenuItem>
            <MenuItem value="area">Area</MenuItem>
            <MenuItem value="ai_rating">AI Rating</MenuItem>
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 120 }}>
          <InputLabel>Order</InputLabel>
          <Select value={sortDir} onChange={(e) => setSortDir(e.target.value)} label="Order">
            <MenuItem value="desc">Descending</MenuItem>
            <MenuItem value="asc">Ascending</MenuItem>
          </Select>
        </FormControl>
        <Chip label={`${total} offers`} color="primary" variant="outlined" />
      </Box>
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
      ) : offers.length === 0 ? (
        <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>No offers found.</Typography>
      ) : (
        <>
          <Grid container spacing={2}>
            {offers.map((o) => (
              <Grid item xs={12} sm={6} md={4} lg={3} key={o.external_id}>
                <OfferCard offer={o} onRate={handleRate}
                  onClick={(x) => { setSelectedId(x.external_id); setDlgOpen(true); }} />
              </Grid>
            ))}
          </Grid>
          {totalPages > 1 && (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
              <Pagination count={totalPages} page={page} onChange={(e, v) => setPage(v)} color="primary" />
            </Box>
          )}
        </>
      )}
      <OfferDetailDialog offerId={selectedId} open={dlgOpen}
        onClose={() => setDlgOpen(false)} onUpdated={() => load()} />
    </Box>
  );
}
