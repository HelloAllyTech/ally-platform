import {ResourceArticle} from './types';

export const trySuggestions = [
  {
    id: 1,
    text: 'Grounding Techniques',
  },
  {
    id: 2,
    text: 'Domestic Violence',
  },
  {
    id: 3,
    text: 'Questions To Encourage Disclosure',
  },
  {
    id: 4,
    text: 'Things To Say To Help Process Grief',
  },
  {
    id: 5,
    text: 'Boundaries',
  },
];

export const searchSuggestions = [
  {
    id: 1,
    text: 'Grounding Techniques',
  },
  {
    id: 2,
    text: 'Domestic Safety Resources',
  },
  {
    id: 3,
    text: 'Domestic Violence',
  },
  {
    id: 4,
    text: 'Domestic Assistance Network',
  },
  {
    id: 5,
    text: 'Domestic Safety Plan',
  },
];

export const tabDefs = [
  {key: 'all', title: 'All'},
  {key: 'resources', title: 'Resources'},
  {key: 'articles', title: 'Articles'},
  {key: 'videos', title: 'Videos'},
  {key: 'podcasts', title: 'Podcasts'},
  {key: 'events', title: 'Events'},
];

export const PAGE_SIZE = 10;
export const allData: {[key: string]: ResourceArticle[]} = {
  all: Array.from({length: 20}, (_, i) => ({
    category: 'Resource',
    tags: ['mental health', 'anxiety'],
    title: `Comprehensive Safety Planning Strategies for Enhanced Protection ${i + 1}`,
    content:
      'Abusers aim to throw survivors off-balance by exerting power and control at random times. Then again, because they often repeat their power and control tactics over and over, survivors often know that the next abusive episode is likely just around the corner. A safety plan is a form of protection that allows a survivor to prepare what they can do during or between abusive incidents to keep themselves and their children safe. This might involve how they can escape, where they can go, who they can rely on to help them and the additional protections they can put in place to possibly stay gone for good.',
  })),
  resources: Array.from({length: 10}, (_, i) => ({
    category: 'Resource',
    tags: ['mental health'],
    title: `Resource Article ${i + 1}`,
    content:
      'This is a resource article. Abusers aim to throw survivors off-balance by exerting power and control at random times. Survivors often know that the next abusive episode is likely just around the corner.',
  })),
  articles: Array.from({length: 8}, (_, i) => ({
    category: 'Article',
    tags: ['wellness'],
    title: `Wellness Article ${i + 1}`,
    content:
      'This is a wellness article. A safety plan is a form of protection that allows a survivor to prepare what they can do during or between abusive incidents to keep themselves and their children safe.',
  })),
  videos: Array.from({length: 5}, (_, i) => ({
    category: 'Video',
    tags: ['video', 'education'],
    title: `Educational Video ${i + 1}`,
    content:
      'This is a video resource. Learn about safety planning and protection strategies for survivors.',
  })),
  podcasts: Array.from({length: 7}, (_, i) => ({
    category: 'Podcast',
    tags: ['audio', 'support'],
    title: `Support Podcast ${i + 1}`,
    content:
      'This is a podcast episode. Listen to stories and advice from survivors and experts.',
  })),
  events: Array.from({length: 3}, (_, i) => ({
    category: 'Event',
    tags: ['community'],
    title: `Community Event ${i + 1}`,
    content:
      'This is a community event. Join us to learn more about safety, support, and resources.',
  })),
};
