import React from 'react';
import {
  Card, CardContent, CardActions, Typography, Chip, Box, IconButton, Tooltip,
} from '@mui/material';
import ThumbUpIcon from '@mui/icons-material/ThumbUp';
import ThumbDownIcon from '@mui/icons-material/ThumbDown';
import KeyboardDoubleArrowUpIcon from '@mui/icons-material/KeyboardDoubleArrowUp';
import KeyboardDoubleArrowDownIcon from '@mui/icons-material/KeyboardDoubleArrowDown';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import ClearIcon from '@mui/icons-material/Clear';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { aiColor, chipToneSx, getOfferBadges, gradeToColorHex, gradeToLabel } from '../offerStatus';

const fmt = (price) => {
  if (!price) return '\u2014';
  return new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 0 }).format(price);
};

const hasValidAiRating = (rating) => Number.isFinite(rating) && rating >= 1 && rating <= 10;

export default function OfferCard({ offer, onRate, onClick }) {
  const borderColor = gradeToColorHex(offer.user_grade);
  const hasUserGrade = offer.user_grade != null;
  const badges = getOfferBadges(offer);

  return (
    <Card
      sx={{ height: '100%', display: 'flex', flexDirection: 'column',
        cursor: 'pointer', '&:hover': { boxShadow: 6 }, borderLeft: `4px solid ${borderColor}`,
        opacity: offer.is_in_trash ? 0.75 : 1 }}
      onClick={() => onClick(offer)}
    >
      <CardContent sx={{ flexGrow: 1 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1, mb: 1 }}>
          <Chip
            label={`User: ${gradeToLabel(offer.user_grade)}`}
            size="small"
            sx={{
              mr: 1,
              bgcolor: hasUserGrade ? gradeToColorHex(offer.user_grade) : 'grey.500',
              color: 'common.white',
              fontWeight: 600,
            }}
          />
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {badges.map((badge) => (
              <Chip key={badge.key} label={badge.label} size="small" sx={chipToneSx(badge.tone)} />
            ))}
            {hasValidAiRating(offer.ai_rating) ? (
              <Chip label={`AI: ${offer.ai_rating}/10`} size="small" color={aiColor(offer.ai_rating)} />
            ) : (
              <Chip label="AI: pending" size="small" sx={chipToneSx('warning')} />
            )}
          </Box>
        </Box>
        <Typography variant="subtitle1" fontWeight="bold" gutterBottom noWrap>
          {offer.title || 'No title'}
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'baseline', mb: 1 }}>
          <Typography variant="h6" color="primary">{fmt(offer.price)}</Typography>
          {offer.area > 0 && <Typography variant="h6" color="primary">{offer.area} m&sup2;</Typography>}
        </Box>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 1 }}>
          {offer.price_per_m2 > 0 && <Typography variant="body2" color="text.secondary">{fmt(offer.price_per_m2)}/m&sup2;</Typography>}
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
          <Tooltip title="Strong like (5)">
            <IconButton color={offer.user_grade === 5 ? 'success' : 'default'}
              onClick={(e) => { e.stopPropagation(); onRate(offer.external_id, 5); }} size="small">
              <KeyboardDoubleArrowUpIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title="Like (4)">
            <IconButton color={offer.user_grade === 4 ? 'success' : 'default'}
              onClick={(e) => { e.stopPropagation(); onRate(offer.external_id, 4); }} size="small">
              <ThumbUpIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title="Neutral (3)">
            <IconButton color={offer.user_grade === 3 ? 'primary' : 'default'}
              onClick={(e) => { e.stopPropagation(); onRate(offer.external_id, 3); }} size="small">
              <HelpOutlineIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title="Dislike (2)">
            <IconButton color={offer.user_grade === 2 ? 'error' : 'default'}
              onClick={(e) => { e.stopPropagation(); onRate(offer.external_id, 2); }} size="small">
              <ThumbDownIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title="Strong dislike (1)">
            <IconButton color={offer.user_grade === 1 ? 'error' : 'default'}
              onClick={(e) => { e.stopPropagation(); onRate(offer.external_id, 1); }} size="small">
              <KeyboardDoubleArrowDownIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title="Clear grade">
            <IconButton
              onClick={(e) => { e.stopPropagation(); onRate(offer.external_id, null); }} size="small">
              <ClearIcon />
            </IconButton>
          </Tooltip>
          {offer.is_in_trash && (
            <Tooltip title="In trash">
              <IconButton size="small" disabled>
                <DeleteOutlineIcon />
              </IconButton>
            </Tooltip>
          )}
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
