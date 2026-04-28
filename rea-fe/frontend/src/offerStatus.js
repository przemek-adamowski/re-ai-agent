export const gradeToColorHex = (grade) => {
  if (grade === 5) return '#2e7d32';
  if (grade === 4) return '#4caf50';
  if (grade === 3) return '#90a4ae';
  if (grade === 2) return '#ef5350';
  if (grade === 1) return '#c62828';
  return '#9e9e9e';
};

export const gradeToLabel = (grade) => {
  if (grade === 5) return 'strong_like';
  if (grade === 4) return 'like';
  if (grade === 3) return 'neutral';
  if (grade === 2) return 'dislike';
  if (grade === 1) return 'strong_dislike';
  return 'unrated';
};

export const aiColor = (rating) => (rating >= 7 ? 'success' : rating >= 4 ? 'warning' : 'error');

export const geoStatusLabel = (status) => {
  if (status === 'in_region') return 'South Krakow';
  if (status === 'out_of_region') return 'Outside south';
  return 'Location unknown';
};

export const reviewStatusLabel = (status) => {
  if (status === 'approved') return 'Approved';
  if (status === 'blocked') return 'Soft blocked';
  if (status === 'trashed') return 'Trash';
  if (status === 'pending') return 'Review queue';
  return 'Active';
};

export const chipToneSx = (tone) => {
  if (tone === 'success') return { bgcolor: '#2e7d32', color: '#fff' };
  if (tone === 'warning') return { bgcolor: '#ed6c02', color: '#fff' };
  if (tone === 'error') return { bgcolor: '#c62828', color: '#fff' };
  if (tone === 'info') return { bgcolor: '#1565c0', color: '#fff' };
  return { bgcolor: '#546e7a', color: '#fff' };
};

export const getOfferBadges = (offer) => {
  const badges = [];

  if (offer.is_in_trash) {
    badges.push({ key: 'review', label: 'Trash', tone: 'default' });
  } else if (offer.review_status === 'approved') {
    badges.push({ key: 'review', label: 'Approved', tone: 'success' });
  } else if (offer.needs_manual_review) {
    badges.push({ key: 'review', label: 'Review queue', tone: 'warning' });
  } else if (offer.is_soft_blocked) {
    badges.push({ key: 'review', label: 'Soft blocked', tone: 'error' });
  }

  if (offer.geo_status === 'in_region') {
    badges.push({ key: 'geo', label: offer.district || 'South Krakow', tone: 'info' });
  } else if (offer.geo_status === 'out_of_region') {
    badges.push({ key: 'geo', label: offer.district ? `Outside: ${offer.district}` : 'Outside south', tone: 'error' });
  } else {
    badges.push({ key: 'geo', label: 'Location unknown', tone: 'default' });
  }

  if (offer.is_exception_candidate) {
    badges.push({ key: 'exception', label: 'Cheap/Large', tone: 'success' });
  }

  return badges;
};