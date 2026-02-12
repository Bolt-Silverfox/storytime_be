import { applyDecorators } from '@nestjs/common';
import {
  ApiOperation,
  ApiOkResponse,
  ApiQuery,
  ApiBearerAuth,
  ApiParam,
  ApiResponse,
} from '@nestjs/swagger';

export function ApiAdminGetAllStories() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({
      summary: 'List all stories',
      description:
        'Returns paginated list of stories with filters for search, recommendations, AI generation, language, and age range.',
    }),
    ApiQuery({
      name: 'page',
      required: false,
      type: Number,
      description: 'Page number (default: 1)',
      example: 1,
    }),
    ApiQuery({
      name: 'limit',
      required: false,
      type: Number,
      description: 'Items per page (default: 10, max: 100)',
      example: 10,
    }),
    ApiQuery({
      name: 'search',
      required: false,
      type: String,
      description: 'Search term for title or description',
      example: 'magic',
    }),
    ApiQuery({
      name: 'recommended',
      required: false,
      type: Boolean,
      description: 'Filter by recommended status',
    }),
    ApiQuery({
      name: 'aiGenerated',
      required: false,
      type: Boolean,
      description: 'Filter by AI-generated status',
    }),
    ApiQuery({
      name: 'isDeleted',
      required: false,
      type: Boolean,
      description: 'Filter by deletion status',
    }),
    ApiQuery({
      name: 'language',
      required: false,
      type: String,
      description: 'Filter by language',
      example: 'english',
    }),
    ApiQuery({
      name: 'minAge',
      required: false,
      type: Number,
      description: 'Minimum age filter',
      example: 3,
    }),
    ApiQuery({
      name: 'maxAge',
      required: false,
      type: Number,
      description: 'Maximum age filter',
      example: 12,
    }),
    ApiOkResponse({
      description: 'Stories retrieved successfully',
      schema: {
        example: {
          statusCode: 200,
          message: 'Stories retrieved successfully',
          data: [
            {
              id: 'story-123',
              title: 'The Magic Forest',
              description: 'A magical adventure in an enchanted forest',
              language: 'english',
              coverImageUrl: 'https://example.com/forest.jpg',
              ageMin: 3,
              ageMax: 8,
              recommended: true,
              aiGenerated: false,
              isDeleted: false,
              createdAt: '2023-10-01T12:00:00Z',
              updatedAt: '2023-10-15T10:30:00Z',
              categories: [{ id: 'cat-1', name: 'Fantasy & Magic' }],
              themes: [{ id: 'theme-1', name: 'Adventure' }],
              favoritesCount: 45,
              viewsCount: 120,
              parentFavoritesCount: 15,
              downloadsCount: 30,
            },
          ],
          meta: {
            total: 325,
            page: 1,
            limit: 10,
            totalPages: 33,
          },
        },
      },
    }),
  );
}

export function ApiAdminGetStoryById() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({
      summary: 'Get story by ID',
      description:
        'Returns detailed story information including images, categories, themes, branches, questions, and engagement metrics.',
    }),
    ApiParam({
      name: 'storyId',
      type: String,
      description: 'Story ID',
      example: 'story-123-uuid',
    }),
    ApiOkResponse({
      description: 'Story details retrieved successfully',
      schema: {
        example: {
          statusCode: 200,
          message: 'Story details retrieved successfully',
          data: {
            id: 'story-123',
            title: 'The Magic Forest',
            description: 'A magical adventure in an enchanted forest',
            language: 'english',
            coverImageUrl: 'https://example.com/forest.jpg',
            audioUrl: 'https://example.com/forest.mp3',
            textContent: 'Once upon a time in a magical forest...',
            isInteractive: true,
            ageMin: 3,
            ageMax: 8,
            backgroundColor: '#5E3A54',
            recommended: true,
            aiGenerated: false,
            difficultyLevel: 1,
            wordCount: 500,
            isDeleted: false,
            createdAt: '2023-10-01T12:00:00Z',
            updatedAt: '2023-10-15T10:30:00Z',
            images: [
              {
                id: 'img-123',
                url: 'https://example.com/forest-1.jpg',
                caption: 'The enchanted forest entrance',
              },
            ],
            categories: [{ id: 'cat-1', name: 'Fantasy & Magic' }],
            themes: [{ id: 'theme-1', name: 'Adventure' }],
            branches: [
              {
                id: 'branch-1',
                prompt: 'Which path will you take?',
                optionA: 'Take the left path',
                optionB: 'Take the right path',
                nextA: 'story-124',
                nextB: 'story-125',
              },
            ],
            questions: [
              {
                id: 'question-1',
                question: "What was the main character's name?",
                options: ['Alice', 'Bob', 'Charlie', 'Diana'],
                correctOption: 0,
              },
            ],
            stats: {
              favoritesCount: 45,
              viewsCount: 120,
              parentFavoritesCount: 15,
              downloadsCount: 30,
            },
          },
        },
      },
    }),
    ApiResponse({
      status: 404,
      description: 'Story not found',
      schema: {
        example: {
          statusCode: 404,
          message: 'Story with ID story-123 not found',
          error: 'Not Found',
        },
      },
    }),
  );
}

export function ApiAdminToggleStoryRecommendation() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({
      summary: 'Toggle story recommendation',
      description: 'Toggles the recommended flag for a story.',
    }),
    ApiParam({
      name: 'storyId',
      type: String,
      description: 'Story ID',
      example: 'story-123-uuid',
    }),
    ApiOkResponse({
      description: 'Story recommendation toggled successfully',
      schema: {
        example: {
          statusCode: 200,
          message: 'Story recommendation toggled successfully',
          data: {
            id: 'story-123',
            title: 'The Magic Forest',
            recommended: true,
            updatedAt: '2023-10-15T10:30:00Z',
          },
        },
      },
    }),
    ApiResponse({
      status: 404,
      description: 'Story not found',
      schema: {
        example: {
          statusCode: 404,
          message: 'Story with ID story-123 not found',
          error: 'Not Found',
        },
      },
    }),
  );
}

export function ApiAdminDeleteStory() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({
      summary: 'Delete story',
      description:
        'Soft deletes a story by default. Use permanent=true query parameter for permanent deletion.',
    }),
    ApiParam({
      name: 'storyId',
      type: String,
      description: 'Story ID',
      example: 'story-123-uuid',
    }),
    ApiQuery({
      name: 'permanent',
      required: false,
      type: Boolean,
      description: 'Permanently delete story (default: false - soft delete)',
      example: false,
    }),
    ApiResponse({ status: 204, description: 'Story deleted successfully' }),
    ApiResponse({
      status: 404,
      description: 'Story not found',
      schema: {
        example: {
          statusCode: 404,
          message: 'Story with ID story-123 not found',
          error: 'Not Found',
        },
      },
    }),
  );
}

export function ApiAdminGetCategories() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({
      summary: 'List all categories',
      description:
        'Returns all categories with story counts and kid preference statistics.',
    }),
    ApiOkResponse({
      description: 'Categories retrieved successfully',
      schema: {
        example: {
          statusCode: 200,
          message: 'Categories retrieved successfully',
          data: [
            {
              id: 'cat-1',
              name: 'Animal Stories',
              image: 'https://example.com/animals.jpg',
              description: 'Stories featuring animals as main characters',
              isDeleted: false,
              deletedAt: null,
              _count: {
                stories: 80,
                preferredByKids: 45,
              },
            },
          ],
        },
      },
    }),
  );
}

export function ApiAdminGetThemes() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({
      summary: 'List all themes',
      description: 'Returns all themes with story counts.',
    }),
    ApiOkResponse({
      description: 'Themes retrieved successfully',
      schema: {
        example: {
          statusCode: 200,
          message: 'Themes retrieved successfully',
          data: [
            {
              id: 'theme-1',
              name: 'Adventure',
              image: 'https://example.com/adventure.jpg',
              description: 'Themes of adventure and exploration',
              isDeleted: false,
              deletedAt: null,
              _count: {
                stories: 120,
              },
            },
          ],
        },
      },
    }),
  );
}
