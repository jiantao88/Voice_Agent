class SimpleWebSearchAgent {
  constructor() {
    this.tavilyApiKey = process.env.TAVILY_API_KEY || '';
  }

  async searchWeb(query, numResults = 5) {
    try {
      if (!this.tavilyApiKey) {
        return {
          results: [{
            title: `Search: ${query}`,
            link: 'https://example.com',
            snippet: `Fallback result for: ${query}. Please configure TAVILY_API_KEY.`,
            source: 'Web: Fallback',
            score: 0.5,
          }],
          searchQuery: query,
          totalResults: 1,
        };
      }

      const { tavily } = await import('@tavily/core');
      const tavilyClient = tavily({ apiKey: this.tavilyApiKey });

      const response = await tavilyClient.search(query, {
        search_depth: 'basic',
        include_answer: false,
        include_images: false,
        include_raw_content: false,
        max_results: numResults,
      });

      if (!response || !response.results) {
        throw new Error('Invalid response from Tavily API');
      }

      const results = response.results.map((result, index) => ({
        title: result.title || `Result ${index + 1}`,
        link: result.url || '',
        snippet: result.content || result.snippet || '',
        source: `Web: ${new URL(result.url).hostname}`,
        score: result.score || 0.8,
      }));

      return { results, searchQuery: query, totalResults: results.length };
    } catch (error) {
      console.error('Web search error:', error);
      return {
        results: [{
          title: `Error searching: ${query}`,
          link: '',
          snippet: `Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          source: 'Web: Error',
          score: 0.1,
        }],
        searchQuery: query,
        totalResults: 0,
      };
    }
  }
}

export const webSearchAgent = new SimpleWebSearchAgent();
