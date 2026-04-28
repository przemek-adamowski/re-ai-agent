import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Typography, Box, Chip, IconButton, Divider, FormControl, InputLabel, Select, MenuItem,
  Link as MuiLink, Grid, CircularProgress, Tooltip,
} from '@mui/material';
import KeyboardDoubleArrowUpIcon from '@mui/icons-material/KeyboardDoubleArrowUp';
import KeyboardDoubleArrowDownIcon from '@mui/icons-material/KeyboardDoubleArrowDown';
import ThumbUpIcon from '@mui/icons-material/ThumbUp';
import ThumbDownIcon from '@mui/icons-material/ThumbDown';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import ClearIcon from '@mui/icons-material/Clear';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DOMPurify from 'dompurify';
import { getOffer, getOfferAudit, reviewOffer, updateOffer } from '../api';
import { aiColor, chipToneSx, getOfferBadges, gradeToColorHex, gradeToLabel } from '../offerStatus';

const fmt = (p) => !p ? '\u2014' : new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 0 }).format(p);

const LEGACY_TO_GRADE = {
  like: 4,
  dislike: 2,
  '👍 I like it': 4,
  "👎 I don't like it": 2,
  pending: '',
};

export default function OfferDetailDialog({ offerId, open, onClose, onUpdated }) {
  const [offer, setOffer] = useState(null);
  const [auditItems, setAuditItems] = useState([]);
  const [notes, setNotes] = useState('');
  const [title, setTitle] = useState('');
  const [rating, setRating] = useState('');
  const [reviewReason, setReviewReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copyHint, setCopyHint] = useState('');

  const handleCopyExternalId = () => {
    if (!offer?.external_id) {
      return;
    }
    if (!navigator?.clipboard?.writeText) {
      setCopyHint('Copy failed');
      setTimeout(() => setCopyHint(''), 1200);
      return;
    }
    void navigator.clipboard.writeText(offer.external_id).then(() => {
      setCopyHint('Copied');
      setTimeout(() => setCopyHint(''), 1200);
    });
  };

  useEffect(() => {
    if (offerId && open) {
      let cancelled = false;
      setLoading(true);
      setError('');
      Promise.all([getOffer(offerId), getOfferAudit(offerId)]).then(([d, audit]) => {
        if (cancelled) {
          return;
        }
        setOffer(d);
        setTitle(d.title || '');
        setAuditItems(audit);
        setNotes(d.user_notes || '');
        setReviewReason(d.review_reason || '');
        const initialGrade = d.user_grade ?? LEGACY_TO_GRADE[d.user_rating] ?? '';
        setRating(initialGrade);
        setLoading(false);
      }).catch((e) => {
        if (!cancelled) {
          setError(e.message || 'Failed to load offer details.');
          setLoading(false);
        }
      });

      return () => {
        cancelled = true;
      };
    }
    return undefined;
  }, [offerId, open]);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    const cleanedTitle = title.trim();
    if (!cleanedTitle) {
      setSaving(false);
      setError('Title cannot be empty.');
      return;
    }
    const payload = { title: cleanedTitle, user_notes: notes };
    if (rating === '') {
      payload.user_rating = 'pending';
    } else {
      payload.user_grade = Number(rating);
    }
    try {
      const updated = await updateOffer(offerId, payload);
      setOffer(updated);
      onUpdated(updated);
      onClose();
    } catch (e) {
      setError(e.message || 'Failed to save assessment.');
    } finally {
      setSaving(false);
    }
  };

  const handleReviewAction = async (action) => {
    if (!reviewReason.trim()) {
      setError('Review reason is required for review actions.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const updated = await reviewOffer(offerId, {
        action,
        actor: 'frontend',
        reason: reviewReason.trim(),
      });
      setOffer(updated);
      onUpdated(updated);
      onClose();
    } catch (e) {
      setError(e.message || 'Failed to update review status.');
    } finally {
      setSaving(false);
    }
  };

  const showApprove = offer && !offer.is_in_trash && (offer.needs_manual_review || offer.review_status === 'blocked');
  const showBlock = offer && !offer.is_in_trash && offer.geo_status !== 'in_region';
  const badges = offer ? getOfferBadges(offer) : [];
  const hasUserGrade = offer?.user_grade != null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth scroll="paper">
      <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1.5 }}>
        {loading ? (
          <Typography variant="h6" noWrap sx={{ maxWidth: '80%' }}>
            Loading...
          </Typography>
        ) : (
          <TextField
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Offer title"
            variant="standard"
            fullWidth
            inputProps={{ 'aria-label': 'Offer title' }}
            sx={{
              maxWidth: '90%',
              '& .MuiInputBase-input': { fontSize: '1.25rem', fontWeight: 500 },
            }}
          />
        )}
        <IconButton onClick={onClose}><CloseIcon /></IconButton>
      </DialogTitle>
      {loading ? (
        <DialogContent sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></DialogContent>
      ) : offer && (
        <DialogContent dividers>
          {error && (
            <Typography color="error" sx={{ mb: 2 }}>{error}</Typography>
          )}
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
              <Typography variant="h6" color="primary">{offer.area ? `${offer.area} m\u00B2` : '\u2014'}</Typography>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Typography variant="caption" color="text.secondary">AI Rating</Typography>
              <Typography variant="h6">{offer.ai_rating != null ? `${offer.ai_rating}/10` : '\u2014'}</Typography>
            </Grid>
          </Grid>
          <Grid container spacing={2} sx={{ mb: 3 }}>
            <Grid item xs={6} sm={3}>
              <Typography variant="caption" color="text.secondary">Category</Typography>
              <Typography variant="body2" color="text.secondary">{offer.category || '\u2014'}</Typography>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Typography variant="caption" color="text.secondary">Lot Size</Typography>
              <Typography variant="body2" color="text.secondary">{offer.lot_size ? `${offer.lot_size} m\u00B2` : '\u2014'}</Typography>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Typography variant="caption" color="text.secondary">Built</Typography>
              <Typography variant="body2" color="text.secondary">{offer.construction_year || '\u2014'}</Typography>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Typography variant="caption" color="text.secondary">Listing</Typography>
              <MuiLink href={offer.url} target="_blank" rel="noopener noreferrer"
                sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                Open <OpenInNewIcon fontSize="small" />
              </MuiLink>
            </Grid>
            <Grid item xs={12}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, opacity: 0.65 }}>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ fontFamily: 'monospace', fontSize: '0.72rem' }}
                >
                  ID: {offer.external_id || '\u2014'}
                </Typography>
                <Tooltip title={copyHint || 'Copy ID'}>
                  <IconButton size="small" onClick={handleCopyExternalId} sx={{ p: 0.35 }}>
                    <ContentCopyIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                </Tooltip>
              </Box>
            </Grid>
          </Grid>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1, flexWrap: 'wrap', mb: 2 }}>
            <Chip
              label={`User: ${gradeToLabel(offer.user_grade)}`}
              size="small"
              sx={{
                bgcolor: hasUserGrade ? gradeToColorHex(offer.user_grade) : 'grey.500',
                color: 'common.white',
                fontWeight: 600,
              }}
            />
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {badges.map((badge) => (
                <Chip key={badge.key} label={badge.label} size="small" sx={chipToneSx(badge.tone)} />
              ))}
              {offer.ai_rating != null && (
                <Chip label={`AI: ${offer.ai_rating}/10`} size="small" color={aiColor(offer.ai_rating)} />
              )}
              {offer.property_portal && <Chip label={offer.property_portal} size="small" variant="outlined" />}
            </Box>
          </Box>
          {offer.geo_reason && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {offer.geo_reason}
            </Typography>
          )}
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
            <FormControl fullWidth size="small" sx={{ mt: 1 }}>
              <InputLabel>Grade</InputLabel>
              <Select value={rating} onChange={(e) => setRating(e.target.value)} label="Grade">
                <MenuItem value="">
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <ClearIcon fontSize="small" /> Unrated
                  </Box>
                </MenuItem>
                <MenuItem value={1}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <KeyboardDoubleArrowDownIcon fontSize="small" /> 1 - Strong dislike
                  </Box>
                </MenuItem>
                <MenuItem value={2}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <ThumbDownIcon fontSize="small" /> 2 - Dislike
                  </Box>
                </MenuItem>
                <MenuItem value={3}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <HelpOutlineIcon fontSize="small" /> 3 - Neutral
                  </Box>
                </MenuItem>
                <MenuItem value={4}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <ThumbUpIcon fontSize="small" /> 4 - Like
                  </Box>
                </MenuItem>
                <MenuItem value={5}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <KeyboardDoubleArrowUpIcon fontSize="small" /> 5 - Strong like
                  </Box>
                </MenuItem>
              </Select>
            </FormControl>
          </Box>
          <TextField label="Property Notes" multiline rows={3} fullWidth value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g., great layout, too small balcony, needs renovation..." />
          <Divider sx={{ my: 2 }} />
          <Typography variant="subtitle1" fontWeight="bold" gutterBottom>Workflow Decision</Typography>
          <TextField
            label="Workflow Reason"
            multiline
            rows={2}
            fullWidth
            value={reviewReason}
            onChange={(e) => setReviewReason(e.target.value)}
            placeholder="Why are you approving, blocking, trashing, or restoring this offer?"
          />
          <Box sx={{ mt: 1 }}>
            <Typography variant="caption" color="text.secondary">
              First seen: {offer.created_at ? new Date(offer.created_at).toLocaleDateString('pl-PL') : '\u2014'}
              {' | '}Last seen: {offer.last_seen_at ? new Date(offer.last_seen_at).toLocaleDateString('pl-PL') : '\u2014'}
              {offer.reviewed_at && ` | Reviewed: ${new Date(offer.reviewed_at).toLocaleDateString('pl-PL')}`}
              {offer.sent_at && ` | Sent: ${new Date(offer.sent_at).toLocaleDateString('pl-PL')}`}
            </Typography>
          </Box>
          {auditItems.length > 0 && (
            <>
              <Divider sx={{ my: 2 }} />
              <Typography variant="subtitle1" fontWeight="bold" gutterBottom>Audit Trail</Typography>
              <Box sx={{ maxHeight: 220, overflowY: 'auto' }}>
                {auditItems.map((item) => (
                  <Box key={item.id} sx={{ py: 1.25, borderBottom: '1px solid', borderColor: 'divider' }}>
                    <Typography variant="body2" fontWeight="bold">{item.event_type.replace(/_/g, ' ')}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {new Date(item.created_at).toLocaleString('pl-PL')} | {item.actor}
                    </Typography>
                    {item.reason && (
                      <Typography variant="body2" color="text.secondary">{item.reason}</Typography>
                    )}
                  </Box>
                ))}
              </Box>
            </>
          )}
        </DialogContent>
      )}
      <DialogActions>
        {offer && !offer.is_in_trash && (
          <Button color="error" onClick={() => handleReviewAction('trash')} disabled={saving || loading}>
            Move to Trash
          </Button>
        )}
        {offer?.is_in_trash && (
          <Button color="secondary" onClick={() => handleReviewAction('restore')} disabled={saving || loading}>
            Restore
          </Button>
        )}
        {showBlock && (
          <Button color="warning" onClick={() => handleReviewAction('keep_blocked')} disabled={saving || loading}>
            Keep Blocked
          </Button>
        )}
        {showApprove && (
          <Button color="success" onClick={() => handleReviewAction('approve')} disabled={saving || loading}>
            Approve
          </Button>
        )}
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={saving || loading}>
          {saving ? 'Saving...' : 'Save Assessment'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
