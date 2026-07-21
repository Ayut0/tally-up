package postgres

import "context"

// IntegrityReport is the result of the architecture.md §5 integrity checks.
// All-zero means the ledger's invariants hold.
type IntegrityReport struct {
	GlobalSum               int64 `json:"global_sum"`
	EntriesWithNonzeroSum   int   `json:"entries_with_nonzero_sum"`
	DoublyReversedOriginals int   `json:"doubly_reversed_originals"`
}

func (r IntegrityReport) OK() bool {
	return r.GlobalSum == 0 && r.EntriesWithNonzeroSum == 0 && r.DoublyReversedOriginals == 0
}

func (s *Store) CheckIntegrity(ctx context.Context) (IntegrityReport, error) {
	var rep IntegrityReport
	if err := s.Pool.QueryRow(ctx,
		`SELECT COALESCE(SUM(amount), 0) FROM postings`).Scan(&rep.GlobalSum); err != nil {
		return rep, err
	}
	if err := s.Pool.QueryRow(ctx, `
		SELECT count(*) FROM (
			SELECT entry_id FROM postings GROUP BY entry_id HAVING SUM(amount) <> 0
		) bad`).Scan(&rep.EntriesWithNonzeroSum); err != nil {
		return rep, err
	}
	if err := s.Pool.QueryRow(ctx, `
		SELECT count(*) FROM (
			SELECT reverses_id FROM entries WHERE reverses_id IS NOT NULL
			GROUP BY reverses_id HAVING count(*) > 1
		) bad`).Scan(&rep.DoublyReversedOriginals); err != nil {
		return rep, err
	}
	return rep, nil
}
