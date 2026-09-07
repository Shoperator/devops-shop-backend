import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ARTICLE_REPOSITORY } from './article.repository';
import { ArticlesService } from './articles.service';
import { ArticleQueryDto } from './dto/article-query.dto';
import { Article } from './entities/article.entity';

function articleFixture(overrides: Partial<Article> = {}): Article {
  return {
    id: 'a0000000-0000-4000-8000-000000000001',
    name: 'Green tea',
    description: 'Loose leaf, 100g',
    price: 12.5,
    quantity: 8,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

/** Builds the query the way the ValidationPipe would hand it to the controller. */
function query(overrides: Partial<ArticleQueryDto> = {}): ArticleQueryDto {
  return Object.assign(new ArticleQueryDto(), overrides);
}

describe('ArticlesService', () => {
  let articlesService: ArticlesService;
  let articleRepository: {
    findPage: jest.Mock;
    findById: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    deleteById: jest.Mock;
  };

  beforeEach(async () => {
    articleRepository = {
      findPage: jest.fn().mockResolvedValue([[], 0]),
      findById: jest.fn(),
      create: jest.fn((data: Partial<Article>) => data as Article),
      save: jest.fn((article: Article) => Promise.resolve(article)),
      deleteById: jest.fn().mockResolvedValue(true),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ArticlesService,
        { provide: ARTICLE_REPOSITORY, useValue: articleRepository },
      ],
    }).compile();

    articlesService = moduleRef.get(ArticlesService);
  });

  describe('list', () => {
    it('translates the page number into a row offset', async () => {
      await articlesService.list(query({ page: 3, limit: 20 }));

      expect(articleRepository.findPage).toHaveBeenCalledWith({
        search: undefined,
        skip: 40,
        take: 20,
      });
    });

    it('reports the total and the number of pages', async () => {
      articleRepository.findPage.mockResolvedValue([[articleFixture()], 42]);

      const page = await articlesService.list(query({ page: 1, limit: 20 }));

      expect(page).toMatchObject({
        total: 42,
        page: 1,
        limit: 20,
        totalPages: 3,
      });
      expect(page.items).toHaveLength(1);
    });

    it('reports zero pages for an empty catalogue', async () => {
      const page = await articlesService.list(query());

      expect(page).toMatchObject({ total: 0, totalPages: 0, items: [] });
    });

    it('passes a search term through', async () => {
      await articlesService.list(query({ search: 'tea' }));

      expect(articleRepository.findPage).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'tea' }),
      );
    });

    it('ignores a search term that is only whitespace', async () => {
      await articlesService.list(query({ search: '   ' }));

      expect(articleRepository.findPage).toHaveBeenCalledWith(
        expect.objectContaining({ search: undefined }),
      );
    });
  });

  describe('create', () => {
    it('stores the article the admin described', async () => {
      const article = await articlesService.create({
        name: 'Green tea',
        description: 'Loose leaf, 100g',
        price: 12.5,
        quantity: 8,
      });

      expect(article).toMatchObject({
        name: 'Green tea',
        description: 'Loose leaf, 100g',
        price: 12.5,
        quantity: 8,
      });
      expect(articleRepository.save).toHaveBeenCalled();
    });

    it('defaults the description to null instead of undefined', async () => {
      const article = await articlesService.create({
        name: 'Green tea',
        price: 12.5,
        quantity: 8,
      });

      expect(article.description).toBeNull();
    });
  });

  describe('update', () => {
    it('changes only the fields the request carried', async () => {
      articleRepository.findById.mockResolvedValue(articleFixture());

      const article = await articlesService.update(
        'a0000000-0000-4000-8000-000000000001',
        {
          quantity: 3,
        },
      );

      expect(article.quantity).toBe(3);
      // A restock must not blank out the description or reset the price.
      expect(article.name).toBe('Green tea');
      expect(article.description).toBe('Loose leaf, 100g');
      expect(article.price).toBe(12.5);
    });

    it('clears an optional field when it is explicitly set to null', async () => {
      articleRepository.findById.mockResolvedValue(articleFixture());

      const article = await articlesService.update(
        'a0000000-0000-4000-8000-000000000001',
        {
          description: null,
        },
      );

      expect(article.description).toBeNull();
    });

    it('accepts a quantity of zero as a real value, not as "unset"', async () => {
      articleRepository.findById.mockResolvedValue(articleFixture());

      const article = await articlesService.update(
        'a0000000-0000-4000-8000-000000000001',
        {
          quantity: 0,
        },
      );

      expect(article.quantity).toBe(0);
    });

    it('throws when the article is gone', async () => {
      articleRepository.findById.mockResolvedValue(null);

      await expect(
        articlesService.update('a0000000-0000-4000-8000-000000000009', {
          quantity: 1,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(articleRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('getById', () => {
    it('returns the article', async () => {
      const stored = articleFixture();
      articleRepository.findById.mockResolvedValue(stored);

      await expect(articlesService.getById(stored.id)).resolves.toBe(stored);
    });

    it('throws when the article does not exist', async () => {
      articleRepository.findById.mockResolvedValue(null);

      await expect(articlesService.getById('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('deletes the article', async () => {
      await expect(
        articlesService.remove('a0000000-0000-4000-8000-000000000001'),
      ).resolves.toBeUndefined();

      expect(articleRepository.deleteById).toHaveBeenCalledWith(
        'a0000000-0000-4000-8000-000000000001',
      );
    });

    it('throws when nothing was deleted', async () => {
      articleRepository.deleteById.mockResolvedValue(false);

      await expect(
        articlesService.remove('a0000000-0000-4000-8000-000000000009'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
