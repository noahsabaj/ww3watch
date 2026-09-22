// Shared by initial load, pagination, and article/story deep links.
// Keep source_id for stable source-profile links; older cached rows may omit it.
export const FEED_COLUMNS = 'id,title,url,summary,published_at,fetched_at,source_id,source_name,source_region,source_lang,source_affiliation,story_id,body_hash,topic,severity,claim,unverified,opinion,actors,image_url,image_width,image_height'
