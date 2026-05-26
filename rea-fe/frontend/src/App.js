import React from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { ThemeProvider, CssBaseline, AppBar, Toolbar, Typography, Box, Tabs, Tab } from '@mui/material';
import HomeIcon from '@mui/icons-material/Home';
import BarChartIcon from '@mui/icons-material/BarChart';
import TimelineIcon from '@mui/icons-material/Timeline';
import { theme } from './theme';
import OfferAssessment from './pages/OfferAssessment';
import Summary from './pages/Summary';
import ImportRuns from './pages/ImportRuns';

function Navigation() {
  const location = useLocation();
  const value = location.pathname === '/summary' ? 1 : location.pathname === '/import-runs' ? 2 : 0;

  return (
    <AppBar position="static" sx={{ mb: 0 }}>
      <Toolbar>
        <Typography variant="h6" sx={{ mr: 4, fontWeight: 'bold' }}>
          REA Dashboard
        </Typography>
        <Tabs value={value} textColor="inherit" indicatorColor="secondary">
          <Tab icon={<HomeIcon />} iconPosition="start" label="Offer Assessment" component={Link} to="/" />
          <Tab icon={<BarChartIcon />} iconPosition="start" label="Summary" component={Link} to="/summary" />
          <Tab icon={<TimelineIcon />} iconPosition="start" label="Import runs" component={Link} to="/import-runs" />
        </Tabs>
      </Toolbar>
    </AppBar>
  );
}

function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <Navigation />
        <Box sx={{ p: 3 }}>
          <Routes>
            <Route path="/" element={<OfferAssessment />} />
            <Route path="/summary" element={<Summary />} />
            <Route path="/import-runs" element={<ImportRuns />} />
          </Routes>
        </Box>
      </BrowserRouter>
    </ThemeProvider>
  );
}

export default App;
