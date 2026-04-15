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
    user_rating TEXT DEFAULT 'pending', -- Legacy status: 'like', 'dislike', 'pending' (kept for POC compatibility)
    user_grade SMALLINT,             -- New 1-5 scale: 1 strong_dislike, 2 dislike, 3 neutral, 4 like, 5 strong_like
    user_notes TEXT,                 -- Personal notes (e.g., 'too small balcony', 'great layout')
    user_rated_at TIMESTAMP,         -- Timestamp when user_grade was set
    
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
COMMENT ON COLUMN rea_property_offers.user_grade IS 'Primary user grade on 1-5 scale (1 strong_dislike ... 5 strong_like)';
COMMENT ON COLUMN rea_property_offers.user_notes IS 'Personal observations and feedback on the property';
COMMENT ON COLUMN rea_property_offers.user_rated_at IS 'Timestamp when user provided a grade';
COMMENT ON COLUMN rea_property_offers.last_seen_at IS 'Last time the scraper confirmed the listing was still active';
COMMENT ON COLUMN rea_property_offers.sent_at IS 'Date when the offer was sent to the user for review';

-- 3. Optimization index
CREATE INDEX IF NOT EXISTS idx_property_created_at ON rea_property_offers(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_property_user_grade ON rea_property_offers(user_grade);
CREATE INDEX IF NOT EXISTS idx_property_user_rated_at ON rea_property_offers(user_rated_at DESC);

-- 4. One-step POC migration (run on existing DB)
ALTER TABLE rea_property_offers
    ADD COLUMN IF NOT EXISTS user_grade SMALLINT;

ALTER TABLE rea_property_offers
    ADD COLUMN IF NOT EXISTS user_rated_at TIMESTAMP;

-- Mapping requested for existing data:
-- like -> 4, dislike -> 2
UPDATE rea_property_offers
SET user_grade = CASE
    WHEN user_rating IN ('like', '👍 I like it') THEN 4
    WHEN user_rating IN ('dislike', '👎 I don''t like it') THEN 2
    ELSE NULL
END;

UPDATE rea_property_offers
SET user_rated_at = COALESCE(user_rated_at, CURRENT_TIMESTAMP)
WHERE user_grade IS NOT NULL;

ALTER TABLE rea_property_offers
    DROP CONSTRAINT IF EXISTS chk_user_grade;

ALTER TABLE rea_property_offers
    ADD CONSTRAINT chk_user_grade
    CHECK (user_grade IS NULL OR user_grade BETWEEN 1 AND 5);