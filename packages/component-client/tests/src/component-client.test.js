import {Component, isComponentClass} from '@liaison/component';
import {Model, isModelClass, isModelAttribute} from '@liaison/model';
import {
  Entity,
  isEntityClass,
  isPrimaryIdentifierAttribute,
  isSecondaryIdentifierAttribute
} from '@liaison/entity';
import isEqual from 'lodash/isEqual';

import {ComponentClient} from '../../..';

describe('ComponentClient', () => {
  const server = {
    receive({query, components, version: clientVersion} = {}) {
      const serverVersion = 1;

      if (clientVersion !== serverVersion) {
        throw Object.assign(
          new Error(
            `The component client version (${clientVersion}) doesn't match the component server version (${serverVersion})`
          ),
          {code: 'COMPONENT_CLIENT_VERSION_DOES_NOT_MATCH_COMPONENT_SERVER_VERSION'}
        );
      }

      // client.getComponents()
      if (
        isEqual({query, components}, {query: {'introspect=>': {'()': []}}, components: undefined})
      ) {
        return {
          result: {
            components: [
              {
                name: 'Movie',
                type: 'Component',
                properties: [
                  {
                    name: 'token',
                    type: 'attribute',
                    value: {__undefined: true},
                    exposure: {get: true, set: true}
                  },
                  {name: 'find', type: 'method', exposure: {call: true}}
                ],
                prototype: {
                  properties: [
                    {name: 'title', type: 'attribute', exposure: {get: true, set: true}},
                    {
                      name: 'isPlaying',
                      type: 'attribute',
                      default: {__function: 'function() { return false; }'},
                      exposure: {get: true}
                    },
                    {name: 'play', type: 'method', exposure: {call: true}}
                  ]
                }
              },
              {
                name: 'Cinema',
                type: 'Component',
                relatedComponents: ['Movie'],
                prototype: {
                  properties: [
                    {
                      name: 'movies',
                      type: 'attribute',
                      exposure: {get: true}
                    }
                  ]
                }
              },
              {
                name: 'Film',
                type: 'Model',
                prototype: {
                  properties: [
                    {
                      name: 'title',
                      type: 'modelAttribute',
                      valueType: 'string',
                      validators: [
                        {
                          name: 'notEmpty',
                          function: {__function: 'value => value.length > 0'},
                          message: 'The validator `notEmpty()` failed'
                        }
                      ],
                      exposure: {get: true, set: true}
                    }
                  ]
                }
              },
              {
                name: 'User',
                type: 'Entity',
                prototype: {
                  properties: [
                    {
                      name: 'id',
                      type: 'primaryIdentifierAttribute',
                      valueType: 'string',
                      default: {__function: 'function() { return this.constructor.generateId(); }'},
                      exposure: {get: true, set: true}
                    },
                    {
                      name: 'email',
                      type: 'secondaryIdentifierAttribute',
                      valueType: 'string',
                      exposure: {get: true, set: true}
                    }
                  ]
                }
              }
            ]
          }
        };
      }

      // Movie.find() with token
      if (
        isEqual(
          {query, components},
          {
            query: {
              '<=': {__component: 'Movie'},
              'find=>': {'()': []}
            },
            components: [{__component: 'Movie', token: 'abc123'}]
          }
        )
      ) {
        return {
          result: [
            {__component: 'movie', title: 'Inception'},
            {__component: 'movie', title: 'The Matrix'}
          ]
        };
      }

      // Movie.find() without token
      if (
        isEqual(
          {query, components},
          {
            query: {
              '<=': {__component: 'Movie'},
              'find=>': {'()': []}
            },
            components: [{__component: 'Movie', token: {__undefined: true}}]
          }
        )
      ) {
        return {
          result: {__error: 'Access denied'}
        };
      }

      // Movie.find({limit: 1})
      if (
        isEqual(
          {query, components},
          {
            query: {
              '<=': {__component: 'Movie'},
              'find=>': {'()': [{limit: 1}]}
            },
            components: [{__component: 'Movie', token: 'abc123'}]
          }
        )
      ) {
        return {
          result: [{__component: 'movie', title: 'Inception'}]
        };
      }

      // movie.play()
      if (
        isEqual(
          {query, components},
          {
            query: {
              '<=': {__component: 'movie', title: 'Inception'},
              'play=>': {'()': []}
            },
            components: [{__component: 'Movie', token: 'abc123'}]
          }
        )
      ) {
        return {
          result: {__component: 'movie', isPlaying: true}
        };
      }

      throw new Error(
        `Received an unknown request (query: ${JSON.stringify(query)}, components: ${JSON.stringify(
          components
        )})`
      );
    }
  };

  test('Getting components', async () => {
    let client = new ComponentClient(server);

    expect(() => client.getComponents()).toThrow(
      "The component client version (undefined) doesn't match the component server version (1)"
    );

    client = new ComponentClient(server, {
      version: 1,
      baseComponents: [Component, Model, Entity]
    });

    const [Movie, Cinema] = client.getComponents();

    expect(isComponentClass(Movie)).toBe(true);
    expect(Movie.getComponentName()).toBe('Movie');

    let attribute = Movie.getAttribute('token');

    expect(attribute.getValue()).toBeUndefined();
    expect(attribute.getExposure()).toEqual({get: true, set: true});

    expect(typeof Movie.find).toBe('function');

    attribute = Movie.prototype.getAttribute('title');

    expect(attribute.isSet()).toBe(false);
    expect(attribute.getDefaultValue()).toBeUndefined();
    expect(attribute.getExposure()).toEqual({get: true, set: true});

    attribute = Movie.prototype.getAttribute('isPlaying');

    expect(attribute.isSet()).toBe(false);
    expect(attribute.getDefaultValue()).toBe(false);
    expect(attribute.getExposure()).toEqual({get: true});

    expect(typeof Movie.prototype.play).toBe('function');

    expect(isComponentClass(Cinema)).toBe(true);
    expect(Array.from(Cinema.getRelatedComponents())).toEqual([Movie]);
  });

  test('Getting models', async () => {
    const client = new ComponentClient(server, {
      version: 1,
      baseComponents: [Component, Model, Entity]
    });

    const [, , Film] = client.getComponents();

    expect(isModelClass(Film)).toBe(true);
    expect(Film.getComponentName()).toBe('Film');

    const attribute = Film.prototype.getAttribute('title');

    expect(isModelAttribute(attribute)).toBe(true);
    expect(attribute.isSet()).toBe(false);
    expect(attribute.getDefaultValue()).toBeUndefined();
    expect(attribute.getExposure()).toEqual({get: true, set: true});
    expect(attribute.getType().toString()).toBe('string');
    expect(attribute.getType().getValidators()).toHaveLength(1);
    expect(
      attribute
        .getType()
        .getValidators()[0]
        .getName()
    ).toBe('notEmpty');
    expect(
      attribute
        .getType()
        .getValidators()[0]
        .getFunction()('Inception')
    ).toBe(true);
    expect(
      attribute
        .getType()
        .getValidators()[0]
        .getFunction()('')
    ).toBe(false);
  });

  test('Getting entities', async () => {
    const client = new ComponentClient(server, {
      version: 1,
      baseComponents: [Component, Model, Entity]
    });

    const [, , , User] = client.getComponents();

    expect(isEntityClass(User)).toBe(true);
    expect(User.getComponentName()).toBe('User');

    let attribute = User.prototype.getAttribute('id');

    expect(isPrimaryIdentifierAttribute(attribute)).toBe(true);
    expect(attribute.getType().toString()).toBe('string');
    expect(typeof attribute.getDefaultValueFunction()).toBe('function');
    expect(attribute.getExposure()).toEqual({get: true, set: true});

    attribute = User.prototype.getAttribute('email');

    expect(isSecondaryIdentifierAttribute(attribute)).toBe(true);
    expect(attribute.getType().toString()).toBe('string');
    expect(attribute.getDefaultValueFunction()).toBeUndefined();
    expect(attribute.getExposure()).toEqual({get: true, set: true});
  });

  test('Invoking methods', async () => {
    const client = new ComponentClient(server, {
      version: 1,
      baseComponents: [Component, Model, Entity]
    });

    const [Movie] = client.getComponents();

    expect(() => Movie.find()).toThrow('Access denied'); // The token is missing

    Movie.token = 'abc123';

    let movies = Movie.find();

    expect(movies).toHaveLength(2);
    expect(movies[0]).toBeInstanceOf(Movie);
    expect(movies[0].title).toBe('Inception');
    expect(movies[1]).toBeInstanceOf(Movie);
    expect(movies[1].title).toBe('The Matrix');

    movies = Movie.find({limit: 1});

    expect(movies).toHaveLength(1);
    expect(movies[0]).toBeInstanceOf(Movie);
    expect(movies[0].title).toBe('Inception');

    let movie = Movie.instantiate({title: 'Inception'});

    movie = movie.play();

    expect(movie).toBeInstanceOf(Movie);

    // Since 'title' did not change, it should not be transported back to the local component
    expect(movie.getAttribute('title').isSet()).toBe(false);

    expect(movie.isPlaying).toBe(true);

    movie = Movie.instantiate({title: 'Inception'});

    // Because 'set' is not exposed, 'isPlaying' should not be transported to the remote component
    movie.isPlaying = true;

    movie = movie.play();
  });
});
