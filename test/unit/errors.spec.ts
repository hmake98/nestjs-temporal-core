import { TemporalClientError, wrapError, toError } from '../../src/errors';

describe('errors', () => {
    describe('TemporalClientError', () => {
        it('is an Error with name, message and cause', () => {
            const cause = new Error('boom');
            const err = new TemporalClientError('wrapped', cause);

            expect(err).toBeInstanceOf(Error);
            expect(err).toBeInstanceOf(TemporalClientError);
            expect(err.name).toBe('TemporalClientError');
            expect(err.message).toBe('wrapped');
            expect(err.cause).toBe(cause);
            expect(err.originalName).toBe('Error');
        });

        it('records the original constructor name', () => {
            class ServiceError extends Error {}
            const err = new TemporalClientError('x', new ServiceError('y'));
            expect(err.originalName).toBe('ServiceError');
        });

        it('extracts gRPC code and details when present', () => {
            const cause = Object.assign(new Error('unavailable'), {
                code: 14,
                details: 'connection refused',
            });
            const err = new TemporalClientError('x', cause);
            expect(err.grpcCode).toBe(14);
            expect(err.grpcDetails).toBe('connection refused');
        });

        it('ignores non-numeric code and non-string details', () => {
            const err = new TemporalClientError('x', { code: 'E', details: 1 });
            expect(err.grpcCode).toBeUndefined();
            expect(err.grpcDetails).toBeUndefined();
        });

        it('keeps a non-Error cause without an originalName', () => {
            const err = new TemporalClientError('x', 'plain string');
            expect(err.cause).toBe('plain string');
            expect(err.originalName).toBeUndefined();
        });

        it('has no cause when none is given', () => {
            const err = new TemporalClientError('x');
            expect(err.cause).toBeUndefined();
            expect('cause' in err && err.cause).toBeFalsy();
        });

        it('tolerates a null cause', () => {
            const err = new TemporalClientError('x', null);
            expect(err.cause).toBeNull();
            expect(err.grpcCode).toBeUndefined();
        });
    });

    describe('wrapError', () => {
        it('returns a TemporalClientError carrying the cause', () => {
            const cause = new Error('boom');
            const err = wrapError('msg', cause);
            expect(err).toBeInstanceOf(TemporalClientError);
            expect(err.message).toBe('msg');
            expect(err.cause).toBe(cause);
        });
    });

    describe('toError', () => {
        it('passes Error instances through untouched', () => {
            const original = new TypeError('bad');
            expect(toError(original)).toBe(original);
        });

        it('wraps non-Error values with the default message and keeps cause', () => {
            const err = toError('a string');
            expect(err).toBeInstanceOf(TemporalClientError);
            expect(err.message).toBe('Unknown error');
            expect((err as TemporalClientError).cause).toBe('a string');
        });

        it('uses the supplied message for non-Error values', () => {
            const err = toError({ code: 1 }, 'custom');
            expect(err.message).toBe('custom');
        });
    });
});
