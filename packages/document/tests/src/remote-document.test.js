import {Registry, RegistryClient, RegistryServer} from '@storable/registry';
import {MemoryStore} from '@storable/memory-store';

import {RemoteDocument, LocalDocument, field, remoteMethod, serialize, deserialize} from '../../..';

describe('RemoteDocument', () => {
  describe('All remote', () => {
    const BaseMovie = Parent =>
      class extends Parent {
        @field('string') title;

        @field('string') genre;

        @field('string') country;

        @field('number') score = 0;
      };

    const registryServer = (() => {
      // Backend

      class Movie extends BaseMovie(LocalDocument) {
        async upvote() {
          const previousScore = this.score;
          this.score++;
          await this.save();
          return previousScore;
        }

        static async getMaximumScore() {
          return 1000;
        }
      }

      const store = new MemoryStore();
      const registry = new Registry({Movie, store});
      return new RegistryServer(registry, {
        serializer: serialize,
        deserializer: deserialize
      });
    })();

    // Frontend

    class Movie extends BaseMovie(RemoteDocument) {
      @remoteMethod() upvote;

      @remoteMethod() static getMaximumScore;
    }

    const remoteRegistry = new RegistryClient(registryServer, {
      serializer: serialize,
      deserializer: deserialize
    });
    const registry = new Registry({Movie, remoteRegistry});

    test('CRUD operations', async () => {
      // Create

      let movie = new registry.Movie({title: 'Inception', genre: 'action'});
      const id = movie.id; // An 'id' should have been generated automatically
      expect(typeof id === 'string').toBe(true);
      expect(id !== '').toBe(true);
      await movie.save();

      // Read

      movie = await registry.Movie.get(id);
      expect(movie instanceof registry.Movie).toBe(true);
      expect(movie.id).toBe(id);
      expect(movie.title).toBe('Inception');
      expect(movie.genre).toBe('action');

      await expect(registry.Movie.get('missing-id')).rejects.toThrow();
      await expect(
        registry.Movie.get('missing-id', {throwIfNotFound: false})
      ).resolves.toBeUndefined();

      movie = await registry.Movie.get(id, {return: {title: true}}); // Partial read
      expect(movie.id).toBe(id);
      expect(movie.title).toBe('Inception');
      expect(movie.genre).toBeUndefined();

      movie = await registry.Movie.get(id, {return: false}); // Existence check
      expect(movie.id).toBe(id);
      expect(movie.title).toBeUndefined();
      expect(movie.genre).toBeUndefined();

      // Update

      movie.title = 'The Matrix';
      await movie.save();
      movie = await registry.Movie.get(id);
      expect(movie.id).toBe(id);
      expect(movie.title).toBe('The Matrix');
      expect(movie.genre).toBe('action');

      movie.genre = undefined;
      await movie.save();
      movie = await registry.Movie.get(id);
      expect(movie.id).toBe(id);
      expect(movie.title).toBe('The Matrix');
      expect(movie.genre).toBeUndefined();

      // Delete

      await movie.delete();
      movie = await registry.Movie.get(id, {throwIfNotFound: false});
      expect(movie).toBeUndefined();
    });

    test('Finding documents', async () => {
      await registry.Movie.deserialize({
        _new: true,
        _id: 'movie1',
        title: 'Inception',
        genre: 'action',
        country: 'USA'
      }).save();
      await registry.Movie.deserialize({
        _new: true,
        _id: 'movie2',
        title: 'Forrest Gump',
        genre: 'drama',
        country: 'USA'
      }).save();
      await registry.Movie.deserialize({
        _new: true,
        _id: 'movie3',
        title: 'Léon',
        genre: 'action',
        country: 'France'
      }).save();

      let movies = await registry.Movie.find();
      expect(movies.map(movie => movie.id)).toEqual(['movie1', 'movie2', 'movie3']);

      movies = await registry.Movie.find({filter: {genre: 'action'}});
      expect(movies.map(movie => movie.id)).toEqual(['movie1', 'movie3']);

      movies = await registry.Movie.find({filter: {genre: 'action', country: 'France'}});
      expect(movies.map(movie => movie.id)).toEqual(['movie3']);

      movies = await registry.Movie.find({filter: {genre: 'adventure'}});
      expect(movies.map(movie => movie.id)).toEqual([]);

      movies = await registry.Movie.find({skip: 1, limit: 1});
      expect(movies.map(movie => movie.id)).toEqual(['movie2']);

      movies = await registry.Movie.find({return: {title: true}});
      expect(movies.map(movie => movie.serialize())).toEqual([
        {_type: 'Movie', _id: 'movie1', title: 'Inception'},
        {_type: 'Movie', _id: 'movie2', title: 'Forrest Gump'},
        {_type: 'Movie', _id: 'movie3', title: 'Léon'}
      ]);

      for (const id of ['movie1', 'movie2', 'movie3']) {
        const movie = await registry.Movie.get(id);
        await movie.delete();
      }
    });

    test('Remote methods', async () => {
      const movie = new registry.Movie({title: 'Inception'});
      await movie.save();
      expect(movie.score).toBe(0);

      let previousScore = await movie.upvote();
      expect(previousScore).toBe(0);
      expect(movie.score).toBe(1);

      previousScore = await movie.upvote();
      expect(previousScore).toBe(1);
      expect(movie.score).toBe(2);

      const maximumScore = await registry.Movie.getMaximumScore();
      expect(maximumScore).toBe(1000);

      await movie.delete();
    });
  });

  describe('Local and remote', () => {
    const BaseDirector = Parent =>
      class extends Parent {
        @field('string') fullName;
      };

    const registryServer = (() => {
      // Backend

      class Director extends BaseDirector(LocalDocument) {}

      const store = new MemoryStore();
      const registry = new Registry({Director, store});
      return new RegistryServer(registry, {
        serializer: serialize,
        deserializer: deserialize
      });
    })();

    // Frontend

    class Movie extends LocalDocument {
      @field('string') title;

      @field('Director') director;
    }

    class Director extends BaseDirector(RemoteDocument) {}

    const store = new MemoryStore();
    const remoteRegistry = new RegistryClient(registryServer, {
      serializer: serialize,
      deserializer: deserialize
    });
    const registry = new Registry({Movie, Director, store, remoteRegistry});

    test('Referencing remote documents', async () => {
      let movie = new registry.Movie({
        title: 'Inception',
        director: {fullName: 'Christopher Nolan'}
      });
      const movieId = movie.id;
      const directorId = movie.director.id;
      await movie.director.save();
      await movie.save();

      // We can fetch the director only
      const director = await registry.Director.get(directorId);
      expect(director instanceof registry.Director).toBe(true);
      expect(director.id).toBe(directorId);
      expect(director.fullName).toBe('Christopher Nolan');

      // Fetching the movie should fetch the director automatically
      movie = await registry.Movie.get(movieId);
      expect(movie instanceof registry.Movie).toBe(true);
      expect(movie.id).toBe(movieId);
      expect(movie.title).toBe('Inception');
      expect(movie.director instanceof registry.Director).toBe(true);
      expect(movie.director.id).toBe(directorId);
      // expect(movie.director.fullName).toBe('Christopher Nolan');
    });
  });
});
