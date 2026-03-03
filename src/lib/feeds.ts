// src/lib/feeds.ts
import type { Feed } from './types'

export const FEEDS: Feed[] = [
  // ── US / WESTERN ────────────────────────────────────────────────
  { name: 'Reuters',            url: 'https://feeds.reuters.com/reuters/worldNews',                              region: 'US/Western', lang: 'en' },
  { name: 'AP News',            url: 'https://rsshub.app/apnews/topics/ap-top-news',                            region: 'US/Western', lang: 'en' },
  { name: 'NPR World',          url: 'https://feeds.npr.org/1004/rss.xml',                                      region: 'US/Western', lang: 'en' },
  { name: 'CNN Middle East',    url: 'https://rss.cnn.com/rss/edition_meast.rss',                              region: 'US/Western', lang: 'en' },
  { name: 'Fox News Nat Sec',   url: 'https://moxie.foxnews.com/google-publisher/national-security.xml',        region: 'US/Western', lang: 'en' },
  { name: 'New York Times',     url: 'https://rss.nytimes.com/services/xml/rss/nyt/MiddleEast.xml',             region: 'US/Western', lang: 'en' },
  { name: 'Washington Post',    url: 'https://feeds.washingtonpost.com/rss/world',                              region: 'US/Western', lang: 'en' },
  { name: 'NBC News',           url: 'https://feeds.nbcnews.com/nbcnews/public/world',                          region: 'US/Western', lang: 'en' },
  { name: 'ABC News',           url: 'https://abcnews.go.com/abcnews/internationalheadlines',                   region: 'US/Western', lang: 'en' },
  { name: 'CBS News',           url: 'https://www.cbsnews.com/latest/rss/world',                                region: 'US/Western', lang: 'en' },

  { name: 'Voice of America',   url: 'https://www.voanews.com/api/ztrqtqpym/rss.xml',                          region: 'US/Western', lang: 'en' },
  { name: 'Radio Free Europe',  url: 'https://www.rferl.org/api/zmpiqormvy/rss.xml',                           region: 'US/Western', lang: 'en' },
  { name: 'UPI',                url: 'https://rss.upi.com/news/world-news.rss',                                 region: 'US/Western', lang: 'en' },
  { name: 'Foreign Policy',     url: 'https://foreignpolicy.com/feed/',                                         region: 'US/Western', lang: 'en' },
  { name: 'The Intercept',      url: 'https://theintercept.com/feed/?rss',                                      region: 'US/Western', lang: 'en' },

  // ── UK ───────────────────────────────────────────────────────────
  { name: 'BBC World',          url: 'https://feeds.bbci.co.uk/news/world/middle_east/rss.xml',                region: 'UK', lang: 'en' },
  { name: 'The Guardian',       url: 'https://www.theguardian.com/world/middleeast/rss',                        region: 'UK', lang: 'en' },
  { name: 'Sky News',           url: 'https://feeds.skynews.com/feeds/rss/middle-east.xml',                     region: 'UK', lang: 'en' },
  { name: 'The Independent',    url: 'https://www.independent.co.uk/news/world/rss',                            region: 'UK', lang: 'en' },
  { name: 'The Economist',      url: 'https://www.economist.com/the-world-this-week/rss.xml',                   region: 'UK', lang: 'en' },
  { name: 'Middle East Eye',    url: 'https://www.middleeasteye.net/rss',                                       region: 'UK', lang: 'en' },

  // ── EUROPEAN ─────────────────────────────────────────────────────
  { name: 'Deutsche Welle',     url: 'https://rss.dw.com/rdf/rss-en-middle-east',                              region: 'European', lang: 'en' },
  { name: 'France 24',          url: 'https://www.france24.com/en/middle-east/rss',                            region: 'European', lang: 'en' },
  { name: 'Euronews',           url: 'https://www.euronews.com/rss',                                            region: 'European', lang: 'en' },
  { name: 'RFI English',        url: 'https://www.rfi.fr/en/rss',                                               region: 'European', lang: 'en' },
  { name: 'Swiss Info',         url: 'https://www.swissinfo.ch/eng/rss/world',                                  region: 'European', lang: 'en' },
  { name: 'Der Spiegel',        url: 'https://www.spiegel.de/international/index.rss',                          region: 'European', lang: 'en' },

  // ── ISRAELI ──────────────────────────────────────────────────────
  { name: 'Times of Israel',    url: 'https://www.timesofisrael.com/feed/',                                     region: 'Israeli', lang: 'en' },
  { name: 'Jerusalem Post',     url: 'https://www.jpost.com/Rss/RssFeedsHeadlines.aspx',                       region: 'Israeli', lang: 'en' },
  { name: 'Haaretz',            url: 'https://www.haaretz.com/cmlink/1.628765',                                 region: 'Israeli', lang: 'en' },
  { name: 'Ynet News',          url: 'https://www.ynet.co.il/Integration/StoryRss2.xml',                       region: 'Israeli', lang: 'en' },
  { name: 'i24 News',           url: 'https://www.i24news.tv/en/rss',                                           region: 'Israeli', lang: 'en' },
  { name: 'Arutz Sheva',        url: 'https://www.israelnationalnews.com/Rss.aspx/News',                       region: 'Israeli', lang: 'en' },
  { name: 'Israel Hayom',       url: 'https://www.israelhayom.com/feed/',                                       region: 'Israeli', lang: 'en' },
  { name: 'Globes',             url: 'https://en.globes.co.il/en/rss',                                          region: 'Israeli', lang: 'en' },

  // ── IRANIAN STATE (ENGLISH) ───────────────────────────────────────
  { name: 'Press TV',           url: 'https://www.presstv.ir/homepagerss.aspx',                                 region: 'Iranian State', lang: 'en' },
  { name: 'IRNA',               url: 'https://en.irna.ir/rss',                                                  region: 'Iranian State', lang: 'en' },
  { name: 'Tasnim News',        url: 'https://www.tasnimnews.com/en/rss',                                       region: 'Iranian State', lang: 'en' },
  { name: 'Fars News',          url: 'https://www.farsnews.ir/rss',                                             region: 'Iranian State', lang: 'en' },
  { name: 'Mehr News',          url: 'https://en.mehrnews.com/rss',                                             region: 'Iranian State', lang: 'en' },
  { name: 'Tehran Times',       url: 'https://www.tehrantimes.com/rss',                                         region: 'Iranian State', lang: 'en' },
  { name: 'ISNA English',       url: 'https://en.isna.ir/rss',                                                  region: 'Iranian State', lang: 'en' },
  { name: 'Iran Daily',         url: 'https://www.iran-daily.com/rss',                                          region: 'Iranian State', lang: 'en' },
  { name: 'Financial Tribune',  url: 'https://financialtribune.com/rss',                                        region: 'Iranian State', lang: 'en' },

  // ── IRANIAN INDEPENDENT ───────────────────────────────────────────
  { name: 'Iran International', url: 'https://www.iranintl.com/en/rss',                                        region: 'Iranian Independent', lang: 'en' },
  { name: 'Radio Farda',        url: 'https://www.radiofarda.com/api/ztrqtqpym/rss.xml',                       region: 'Iranian Independent', lang: 'en' },

  // ── IRANIAN LOCAL (PERSIAN) ──────────────────────────────────────
  { name: 'Hamshahri',          url: 'https://www.hamshahrionline.ir/rss',                                      region: 'Iranian Local', lang: 'fa' },
  { name: 'Khabar Online',      url: 'https://www.khabaronline.ir/rss',                                         region: 'Iranian Local', lang: 'fa' },
  { name: 'ISNA Persian',       url: 'https://isna.ir/rss',                                                     region: 'Iranian Local', lang: 'fa' },
  { name: 'Tabnak',             url: 'https://www.tabnak.ir/fa/rss',                                            region: 'Iranian Local', lang: 'fa' },
  { name: 'Mashregh News',      url: 'https://www.mashreghnews.ir/rss',                                         region: 'Iranian Local', lang: 'fa' },
  { name: 'Entekhab',           url: 'https://www.entekhab.ir/rss',                                             region: 'Iranian Local', lang: 'fa' },
  { name: 'Alef News',          url: 'https://www.alef.ir/rss.xml',                                             region: 'Iranian Local', lang: 'fa' },
  { name: 'Shargh Daily',       url: 'https://sharghdaily.com/rss',                                             region: 'Iranian Local', lang: 'fa' },
  { name: 'Aftab News',         url: 'https://www.aftabnews.ir/rss',                                            region: 'Iranian Local', lang: 'fa' },
  { name: 'Donya-e-Eqtesad',    url: 'https://donya-e-eqtesad.com/rss',                                        region: 'Iranian Local', lang: 'fa' },
  { name: 'Jahan News',         url: 'https://www.jahannews.com/rss',                                           region: 'Iranian Local', lang: 'fa' },
  { name: 'Raja News',          url: 'https://www.rajanews.com/rss',                                            region: 'Iranian Local', lang: 'fa' },
  { name: 'IRNA Isfahan',       url: 'https://www.irna.ir/rss/taglist/84001',                                   region: 'Iranian Local', lang: 'fa' },
  { name: 'IRNA Khorasan',      url: 'https://www.irna.ir/rss/taglist/84008',                                   region: 'Iranian Local', lang: 'fa' },
  { name: 'IRNA Khuzestan',     url: 'https://www.irna.ir/rss/taglist/84011',                                   region: 'Iranian Local', lang: 'fa' },
  { name: 'IRNA Kermanshah',    url: 'https://www.irna.ir/rss/taglist/84013',                                   region: 'Iranian Local', lang: 'fa' },
  { name: 'IRNA Fars',          url: 'https://www.irna.ir/rss/taglist/84004',                                   region: 'Iranian Local', lang: 'fa' },

  // ── ARAB / GULF ───────────────────────────────────────────────────
  { name: 'Al Jazeera English', url: 'https://www.aljazeera.com/xml/rss/all.xml',                              region: 'Arab/Gulf', lang: 'en' },
  { name: 'Al Jazeera Arabic',  url: 'https://www.aljazeera.net/aljazeerarss/a2/a2.xml',                       region: 'Arab/Gulf', lang: 'ar' },
  { name: 'Al Arabiya English', url: 'https://english.alarabiya.net/rss',                                       region: 'Arab/Gulf', lang: 'en' },
  { name: 'Arab News',          url: 'https://www.arabnews.com/rss.xml',                                        region: 'Arab/Gulf', lang: 'en' },
  { name: 'Saudi Gazette',      url: 'https://saudigazette.com.sa/rss',                                         region: 'Arab/Gulf', lang: 'en' },
  { name: 'Gulf News',          url: 'https://gulfnews.com/rss',                                                region: 'Arab/Gulf', lang: 'en' },
  { name: 'The National (UAE)', url: 'https://www.thenationalnews.com/rss',                                     region: 'Arab/Gulf', lang: 'en' },
  { name: 'Khaleej Times',      url: 'https://www.khaleejtimes.com/rss.xml',                                    region: 'Arab/Gulf', lang: 'en' },
  { name: 'KUNA',               url: 'https://www.kuna.net.kw/rss',                                             region: 'Arab/Gulf', lang: 'en' },
  { name: 'Kuwait Times',       url: 'https://www.kuwaittimes.com/feed/',                                       region: 'Arab/Gulf', lang: 'en' },
  { name: 'Qatar News Agency',  url: 'https://www.qna.org.qa/en/rss',                                          region: 'Arab/Gulf', lang: 'en' },
  { name: 'The Peninsula',      url: 'https://www.thepeninsulaqatar.com/rss',                                   region: 'Arab/Gulf', lang: 'en' },
  { name: 'Bahrain News Agency',url: 'https://www.bna.bh/en/rss',                                              region: 'Arab/Gulf', lang: 'en' },
  { name: 'Oman News Agency',   url: 'https://omannews.gov.om/rss',                                             region: 'Arab/Gulf', lang: 'en' },
  { name: 'Jordan Times',       url: 'https://www.jordantimes.com/rss/',                                        region: 'Arab/Gulf', lang: 'en' },
  { name: 'Naharnet',           url: 'https://www.naharnet.com/stories/en/rss',                                 region: 'Arab/Gulf', lang: 'en' },
  { name: "L'Orient Today",     url: 'https://www.lorientlejour.com/rss',                                       region: 'Arab/Gulf', lang: 'en' },
  { name: 'SANA (Syria)',        url: 'https://sana.sy/en/?feed=rss2',                                          region: 'Arab/Gulf', lang: 'en' },
  { name: 'Shafaq News',        url: 'https://shafaq.com/en/rss',                                               region: 'Arab/Gulf', lang: 'en' },
  { name: 'Iraqi News',         url: 'https://www.iraqinews.com/feed/',                                         region: 'Arab/Gulf', lang: 'en' },
  { name: 'Asharq Al-Awsat',    url: 'https://english.aawsat.com/rss',                                         region: 'Arab/Gulf', lang: 'en' },
  { name: 'Middle East Monitor',url: 'https://www.middleeastmonitor.com/feed/',                                 region: 'Arab/Gulf', lang: 'en' },
  { name: 'Al-Monitor',         url: 'https://www.al-monitor.com/rss',                                         region: 'Arab/Gulf', lang: 'en' },
  { name: 'The New Arab',       url: 'https://www.newarab.com/rss.xml',                                         region: 'Arab/Gulf', lang: 'en' },
  { name: 'Mada Masr (Egypt)',  url: 'https://www.madamasr.com/en/feed/',                                       region: 'Arab/Gulf', lang: 'en' },
  { name: 'Al-Ahram',           url: 'https://english.ahram.org.eg/rss.aspx/NewsContentID/2.aspx',             region: 'Arab/Gulf', lang: 'en' },

  // ── KURDISH ───────────────────────────────────────────────────────
  { name: 'Rudaw',              url: 'https://www.rudaw.net/english/rss',                                       region: 'Kurdish', lang: 'en' },
  { name: 'Kurdistan 24',       url: 'https://www.kurdistan24.net/en/rss',                                      region: 'Kurdish', lang: 'en' },
  { name: 'BasNews',            url: 'https://www.basnews.com/en/rss',                                          region: 'Kurdish', lang: 'en' },
  { name: 'NRT Digital',        url: 'https://www.nrttv.com/en/rss',                                            region: 'Kurdish', lang: 'en' },

  // ── TURKISH ───────────────────────────────────────────────────────
  { name: 'Daily Sabah',        url: 'https://www.dailysabah.com/rss',                                          region: 'Turkish', lang: 'en' },
  { name: 'Hurriyet Daily',     url: 'https://www.hurriyetdailynews.com/rss',                                   region: 'Turkish', lang: 'en' },
  { name: 'Anadolu Agency',     url: 'https://www.aa.com.tr/en/rss/default',                                    region: 'Turkish', lang: 'en' },
  { name: 'TRT World',          url: 'https://www.trtworld.com/rss',                                            region: 'Turkish', lang: 'en' },

  // ── RUSSIAN ───────────────────────────────────────────────────────
  { name: 'TASS',               url: 'https://tass.com/rss/v2.xml',                                             region: 'Russian', lang: 'en' },
  { name: 'RT',                 url: 'https://www.rt.com/rss/',                                                  region: 'Russian', lang: 'en' },
  { name: 'Sputnik',            url: 'https://sputniknews.com/export/rss2/military_news/index.xml',            region: 'Russian', lang: 'en' },
  { name: 'Meduza',             url: 'https://meduza.io/en/rss/all',                                            region: 'Russian', lang: 'en' },
  { name: 'The Moscow Times',   url: 'https://www.themoscowtimes.com/rss',                                      region: 'Russian', lang: 'en' },

  // ── CHINESE ───────────────────────────────────────────────────────
  { name: 'Xinhua',             url: 'https://www.xinhuanet.com/english/rss/worldrss.xml',                      region: 'Chinese', lang: 'en' },
  { name: 'Global Times',       url: 'https://www.globaltimes.cn/rss/outbrain.xml',                             region: 'Chinese', lang: 'en' },
  { name: 'China Daily',        url: 'https://www.chinadaily.com.cn/rss/world_rss.xml',                         region: 'Chinese', lang: 'en' },
  { name: 'CGTN',               url: 'https://www.cgtn.com/subscribe/rss/section/world-news.do',                region: 'Chinese', lang: 'en' },
  { name: 'South China Morning Post', url: 'https://www.scmp.com/rss/91/feed',                                  region: 'Chinese', lang: 'en' },

  // ── SOUTH ASIAN ───────────────────────────────────────────────────
  { name: 'Dawn (Pakistan)',    url: 'https://www.dawn.com/feeds/home',                                         region: 'South Asian', lang: 'en' },
  { name: 'Geo News',           url: 'https://www.geo.tv/rss/1',                                                region: 'South Asian', lang: 'en' },
  { name: 'The News Intl',      url: 'https://www.thenews.com.pk/rss/1/1',                                      region: 'South Asian', lang: 'en' },
  { name: 'The Hindu',          url: 'https://www.thehindu.com/news/international/?service=rss',                region: 'South Asian', lang: 'en' },
  { name: 'Times of India',     url: 'https://timesofindia.indiatimes.com/rssfeeds/296589292.cms',              region: 'South Asian', lang: 'en' },
  { name: 'NHK World',          url: 'https://www3.nhk.or.jp/nhkworld/en/news/feeds/rss.xml',                  region: 'South Asian', lang: 'en' },

  // ── INDEPENDENT / OSINT ───────────────────────────────────────────
  { name: 'Bellingcat',         url: 'https://www.bellingcat.com/feed/',                                        region: 'Independent/OSINT', lang: 'en' },
  { name: 'The Cradle',         url: 'https://thecradle.co/rss.xml',                                           region: 'Independent/OSINT', lang: 'en' },
  { name: 'Mondoweiss',         url: 'https://mondoweiss.net/feed/',                                            region: 'Independent/OSINT', lang: 'en' },
  { name: 'Electronic Intifada',url: 'https://electronicintifada.net/feeds/news',                               region: 'Independent/OSINT', lang: 'en' },
  { name: '+972 Magazine',      url: 'https://www.972mag.com/feed/',                                            region: 'Independent/OSINT', lang: 'en' },
  { name: 'War on the Rocks',   url: 'https://warontherocks.com/feed/',                                         region: 'Independent/OSINT', lang: 'en' },
  { name: 'Responsible Statecraft', url: 'https://responsiblestatecraft.org/feed/',                             region: 'Independent/OSINT', lang: 'en' },
  { name: 'The Grayzone',       url: 'https://thegrayzone.com/feed/',                                           region: 'Independent/OSINT', lang: 'en' },
  { name: 'CFR',                url: 'https://www.cfr.org/rss',                                                 region: 'Independent/OSINT', lang: 'en' },
  { name: 'Lawfare',            url: 'https://www.lawfaremedia.org/feed/',                                      region: 'Independent/OSINT', lang: 'en' },
]
