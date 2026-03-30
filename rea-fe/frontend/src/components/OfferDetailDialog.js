import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Typography, Box, Chip, IconButton, Divider, ToggleButtonGroup, ToggleButton,
  Link as MuiLink, Grid, CircularProgress,
} from '@mui/material';
import ThumbUpIcon from '@mui/icons-material/ThumbUp';
import ThumbDownIcon from '@mui/icons-material/ThumbDown';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import CloseIcon from '@mui/icons-material/Close';
import DOMPurify from 'dompurify';
import { getOffer, updateOffer } from '../api';

const fmt = (p) => !p ? '\u2014' : new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 0 }).format(p);

export default function OfferDetailDialog({ offerId, open, onClose, onUpdated }) {
  const [offer, setOffer] = useState(null);
  const [notes, setNotes] = useState('');
  const [rating, setRating] = useState('pending');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (offerId && open) {
      setLoading(true);
      getOffer(offerId).then((d) => {
        setOffer(d);
        setNotes(d.user_notes || '');
        setRating(d.user_rating || 'pending');
        setLoading(false);
      });
    }
  }, [offerId, open]);

  const handleSave = async () => {
    setSaving(true);
    const updated = await updateOffer(offerId, { user_rating: rating, user_notes: notes });
    setOffer(updated);
    setSaving(false);
    onUpdated(updated);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth scroll="paper">
      <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h6" noWrap sx={{ maxWidth: '80%' }}>
          {loading ? 'Loading...' : (offer?.title || 'Offer Details')}
        </Typography>
        <IconButton onClick={onClose}><CloseIcon /></IconButton>
      </DialogTitle>
      {loading ? (
        <DialogContent sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></DialogContent>
      ) : offer && (
        <DialogContent dividers>
          <Grid container spacing={2} sx={{ mb: 3 }}>
            <Grid item xs={6} sm={3}>
              <Typography variant="caption" color="text.secondary">Price</Typography>
              <Typography variant="h6" color="primary">{fmt(offer.price)}</Typography>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Typography variant="caption" color="text.secondary">Price/m&sup2;</Typography>
              <Typography variant="h6">{fmt(offer.price_per_m2)}</Typography>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Typography variant="caption" color="text.secondary">Area</Typography>
              <Typography variant="h6">{offer.area ? `${offer.area} m\u00B2` : '\u2014'}</Typography>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Typography variant="caption" color="text.secondary">AI Rating</Typography>
              <Typography variant="h6">{offer.ai_rating != null ? `${offer.ai_rating}/10` : '\u2014'}</Typography>
            </Grid>
          </Grid>
          <Grid container spacing={2} sx={{ mb: 3 }}>
            <Grid item xs={6} sm={3}>
              <Typography variant="caption" color="text.secondary">Category</Typography>
              <Box><Chip label={offer.category} size="small" /></Box>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Typography variant="caption" color="text.secondary">Lot Size</Typography>
              <Typography>{offer.lot_size ? `${offer.lot_size} m\u00B2` : '\u2014'}</Typography>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Typography variant="caption" color="text.secondary">Built</Typography>
              <Typography>{offer.construction_year || '\u2014'}</Typography>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Typography variant="caption" color="text.secondary">Listing</Typography>
              <MuiLink href={offer.url} target="_blank" rel="noopener noreferrer"
                sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                Open <OpenInNewIcon fontSize="small" />
              </MuiLink>
            </Grid>
          </Grid>
          <Divider sx={{ my: 2 }} />
          {offer.ai_analysis_html && (
            <>
              <Typography variant="subtitle1" fontWeight="bold" gutterBottom>AI Analysis</Typography>
              <Box sx={{ p: 2, bgcolor: 'grey.50', borderRadius: 1, mb: 3,
                '& img': { maxWidth: '100%' },
                '& table': { borderCollapse: 'collapse', width: '100%' },
                '& td, & th': { border: '1px solid #ddd', p: 1 } }}
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(offer.ai_analysis_html) }} />
              <Divider sx={{ my: 2 }} />
            </>
          )}
          <Typography variant="subtitle1" fontWeight="bold" gutterBottom>Your Assessment</Typography>
          <Box sx={{ mb: 2 }}>
            <Typography variant="caption" color="text.secondary" gutterBottom>Rating</Typography>
            <ToggleButtonGroup value={rating} exclusive
              onChange={(e, val) => val && setRating(val)} fullWidth sx={{ mt: 1 }}>
              <ToggleButton value="like" color="success"><ThumbUpIcon sx={{ mr: 1 }} /> Like</ToggleButton>
              <ToggleButton value="pending" color="info"><HelpOutlineIcon sx={{ mr: 1 }} /> Pending</ToggleButton>
              <ToggleButton value="dislike" color="error"><ThumbDownIcon sx={{ mr: 1 }} /> Dislike</ToggleButton>
            </ToggleButtonGroup>
          </Box>
          <TextField label="Your Notes" multiline rows={3} fullWidth value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g., great layout, too small balcony, needs renovation..." />
          <Box sx={{ mt: 1 }}>
            <Typography variant="caption" color="text.secondary">
              First seen: {offer.created_at ? new Date(offer.created_at).toLocaleDateString('pl-PL') : '\u2014'}
              {' | '}Last seen: {offer.last_seen_at ? new Date(offer.last_seen_at).toLocaleDateString('pl-PL') : '\u2014'}
              {offer.sent_at && ` | Sent: ${new Date(offer.sent_at).toLocaleDateString('pl-PL')}`}
            </Typography>
          </Box>
        </DialogContent>
      )}
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={saving || loading}>
          {saving ? 'Saving...' : 'Save Assessment'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
