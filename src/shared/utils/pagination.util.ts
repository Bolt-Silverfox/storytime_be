export class PaginationUtil {
    /**
     * Sanitizes page and limit query parameters.
     * Default limit is 10. Max limit is enforced (default 100).
     */
    static sanitize(page: any, limit: any, maxLimit = 100) {
        const pageNumber = Math.max(1, Number(page) || 1);
        let limitNumber = Number(limit) || 10;

        if (limitNumber < 1) {
            limitNumber = 10;
        }

        if (limitNumber > maxLimit) {
            limitNumber = maxLimit;
        }

        return {
            page: pageNumber,
            limit: limitNumber,
        };
    }
}
