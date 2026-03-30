-- 1. Create the main table for property offers
CREATE TABLE IF NOT EXISTS rea_property_offers (
    external_id TEXT PRIMARY KEY,    -- Unique MD5 hash of the URL
    category TEXT,                   -- Search category (e.g., 'mieszkanie-krakow', 'dom-krakow', 'dom-pod-krakowem')
    url TEXT NOT NULL,               -- Direct link to the listing
    title TEXT,                      -- Listing title
    
    -- Financial and technical metrics
    price NUMERIC,                   -- Total price in PLN
    price_per_m2 NUMERIC,            -- Calculated price per square meter
    area NUMERIC,                    -- Total area in square meters
    lot_size NUMERIC,				 -- Total land/plot area in square meters
    construction_year INTEGER,		 -- The year the property was built		
    
    -- AI and User evaluation system
    ai_rating INTEGER,               -- Score given by Gemini (1-10 scale)
    ai_analysis_html TEXT,           -- Detailed HTML analysis by AI
    user_rating TEXT DEFAULT 'pending', -- Status: 'like', 'dislike', 'pending'
    user_notes TEXT,                 -- Personal notes (e.g., 'too small balcony', 'great layout')
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, -- First discovered
    last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, -- Last confirmed active
    sent_at DATE -- Date when the offer was sent to the user for review
);

-- 2. Add professional comments (metadata)
COMMENT ON TABLE rea_property_offers IS 'Main storage for property listings discovered by Real Estate AI Agent';

COMMENT ON COLUMN rea_property_offers.external_id IS 'Unique identifier based on URL to prevent duplicates';
COMMENT ON COLUMN rea_property_offers.category IS 'Tag used for filtering different search queries';
COMMENT ON COLUMN rea_property_offers.price IS 'Total listing price (cleaned numeric value)';
COMMENT ON COLUMN rea_property_offers.price_per_m2 IS 'Price per 1m2 for market value analysis';
COMMENT ON COLUMN rea_property_offers.area IS 'Total usable floor area';
COMMENT ON COLUMN rea_property_offers.lot_size IS 'Total land/plot area in square meters';
COMMENT ON COLUMN rea_property_offers.construction_year IS 'The year the property was built';
COMMENT ON COLUMN rea_property_offers.ai_rating IS 'Investment or lifestyle potential score calculated by LLM';
COMMENT ON COLUMN rea_property_offers.ai_analysis_html IS 'Detailed HTML analysis by AI';
COMMENT ON COLUMN rea_property_offers.user_rating IS 'User decision status for training and filtering';
COMMENT ON COLUMN rea_property_offers.user_notes IS 'Personal observations and feedback on the property';
COMMENT ON COLUMN rea_property_offers.last_seen_at IS 'Last time the scraper confirmed the listing was still active';
COMMENT ON COLUMN rea_property_offers.sent_at IS 'Date when the offer was sent to the user for review';

-- 3. Optimization index
CREATE INDEX IF NOT EXISTS idx_property_created_at ON rea_property_offers(created_at DESC);