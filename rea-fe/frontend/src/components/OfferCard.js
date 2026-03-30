import React from 'react';
import {
  Card, CardContent, CardActions, Typography, Chip, Box, IconButton, Tooltip,
} from '@mui/material';
import ThumbUpIcon from '@mui/icons-material/ThumbUp';
import ThumbDownIcon from '@mui/icons-material/ThumbDown';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';

const fmt = (price) => {
  if (!price) return '\u2014';
  return new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 0 }).format(price);
};

const aiColor = (r) => r >= 7 ? 'success' : r >= 4 ? 'warning' : 'error';

export default function OfferCard({ offer, onRate, onClick }) {
  const bc = offer.user_rating === 'like' ? '#4caf50'
    : offer.user_rating === 'dislike' ? '#f44336' : '#9e9e9e';

  return (
    <Card
      sx={{ height: '100%', display: 'flex', flexDirection: 'column',
        cursor: 'pointer', '&:hover': { boxShadow: 6 }, borderLeft: `4px solid ${bc}` }}
      onClick={() => onClick(offer)}
    >
      <CardContent sx={{ flexGrow: 1 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
          <Chip label={offer.category} size="small" color="primary" variant="outlined" />
          {offer.ai_rating != null && (
            <Chip label={`AI: ${offer.ai_rating}/10`} size="small" color={aiColor(offer.ai_rating)} />
          )}
        </Box>
        <Typography variant="subtitle1" fontWeight="bold" gutterBottom noWrap>
          {offer.title || 'No title'}
        </Typography>
        <Typography variant="h6" color="primary" gutterBottom>{fmt(offer.price)}</Typography>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 1 }}>
          {offer.price_per_m2 > 0 && <Typography variant="body2" color="text.secondary">{fmt(offer.price_per_m2)}/m&sup2;</Typography>}
          {offer.area > 0 && <Typography variant="body2" color="text.secondary">{offer.area} m&sup2;</Typography>}
          {offer.lot_size > 0 && <Typography variant="body2" color="text.secondary">Lot: {offer.lot_size} m&sup2;</Typography>}
          {offer.construction_year && <Typography variant="body2" color="text.secondary">Built: {offer.construction_year}</Typography>}
        </Box>
        {offer.user_notes && (
          <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic', mt: 1 }} noWrap>
            &ldquo;{offer.user_notes}&rdquo;
          </Typography>
        )}
      </CardContent>
      <CardActions sx={{ justifyContent: 'space-between', px: 2, pb: 2 }}>
        <Box>
          <Tooltip title="Like">
            <IconButton color={offer.user_rating === 'like' ? 'success' : 'default'}
              onClick={(e) => { e.stopPropagation(); onRate(offer.external_id, 'like'); }} size="small">
              <ThumbUpIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title="Dislike">
            <IconButton color={offer.user_rating === 'dislike' ? 'error' : 'default'}
              onClick={(e) => { e.stopPropagation(); onRate(offer.external_id, 'dislike'); }} size="small">
              <ThumbDownIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title="Reset to pending">
            <IconButton color={offer.user_rating === 'pending' ? 'primary' : 'default'}
              onClick={(e) => { e.stopPropagation(); onRate(offer.external_id, 'pending'); }} size="small">
              <HelpOutlineIcon />
            </IconButton>
          </Tooltip>
        </Box>
        <Tooltip title="Open listing">
          <IconButton href={offer.url} target="_blank" rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()} size="small" color="primary">
            <OpenInNewIcon />
          </IconButton>
        </Tooltip>
      </CardActions>
    </Card>
  );
}
