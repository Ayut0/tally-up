package rest

import (
	"bytes"
	"io"
	"net/http"
	"sync"
	"testing"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/getkin/kin-openapi/routers"
	"github.com/getkin/kin-openapi/routers/gorillamux"
)

// specPath is spec/openapi.yaml relative to this package. The Go server does
// not generate handlers from the spec (see #93) — it validates its own
// responses against the committed contract, so drift between what a handler
// actually returns and what spec/main.tsp promises fails a test instead of
// surfacing as a client bug.
const specPath = "../../../spec/openapi.yaml"

var (
	specOnce   sync.Once
	specRouter routers.Router
	specErr    error
)

func loadSpecRouter() (routers.Router, error) {
	specOnce.Do(func() {
		loader := openapi3.NewLoader()
		doc, err := loader.LoadFromFile(specPath)
		if err != nil {
			specErr = err
			return
		}
		if err := doc.Validate(loader.Context); err != nil {
			specErr = err
			return
		}
		// gorillamux matches scheme+host against doc.Servers, but the test
		// server listens on an httptest-assigned 127.0.0.1 port, not the
		// documented http://localhost:8080. Route on path only — see the
		// ErrPathNotFound note on routers.Router.FindRoute.
		doc.Servers = openapi3.Servers{{URL: "/"}}
		specRouter, specErr = gorillamux.NewRouter(doc)
	})
	return specRouter, specErr
}

// validatingHandler wraps h so every request and response it handles is
// checked against spec/openapi.yaml: unroutable paths, undocumented status
// codes, and bodies that don't match their schema all fail t. Wrap
// newTestServer's handler with this so every existing handler test doubles
// as a contract check with no changes to the tests themselves.
func validatingHandler(t *testing.T, h http.Handler) http.Handler {
	t.Helper()
	router, err := loadSpecRouter()
	if err != nil {
		t.Fatalf("load %s: %v", specPath, err)
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var reqBody []byte
		if r.Body != nil {
			reqBody, _ = io.ReadAll(r.Body)
		}

		route, pathParams, err := router.FindRoute(r)
		if err != nil {
			t.Errorf("openapi: %s %s: %v", r.Method, r.URL.Path, err)
			r.Body = io.NopCloser(bytes.NewReader(reqBody))
			h.ServeHTTP(w, r)
			return
		}

		reqInput := &openapi3filter.RequestValidationInput{
			Request: r, PathParams: pathParams, Route: route,
		}
		r.Body = io.NopCloser(bytes.NewReader(reqBody))
		reqErr := openapi3filter.ValidateRequest(r.Context(), reqInput)
		r.Body = io.NopCloser(bytes.NewReader(reqBody))

		rec := &specRecorder{ResponseWriter: w, status: http.StatusOK, body: &bytes.Buffer{}}
		h.ServeHTTP(rec, r)

		// A request the spec calls invalid is only a contract bug if the handler
		// went ahead and accepted it anyway. Tests that deliberately send a
		// malformed request to prove the handler rejects it (e.g. a missing
		// Idempotency-Key) are exercising exactly the 4xx path the spec
		// documents, and should not fail here for doing that on purpose.
		if reqErr != nil && rec.status < http.StatusBadRequest {
			t.Errorf("openapi: request %s %s accepted with status %d despite: %v",
				r.Method, r.URL.Path, rec.status, reqErr)
		}

		respInput := &openapi3filter.ResponseValidationInput{
			RequestValidationInput: reqInput,
			Status:                 rec.status,
			Header:                 w.Header(),
			Options:                &openapi3filter.Options{IncludeResponseStatus: true},
		}
		respInput.SetBodyBytes(rec.body.Bytes())
		if err := openapi3filter.ValidateResponse(r.Context(), respInput); err != nil {
			t.Errorf("openapi: response %d from %s %s: %v\nbody: %s",
				rec.status, r.Method, r.URL.Path, err, rec.body.Bytes())
		}
	})
}

// specRecorder captures the status and body a handler writes while still
// forwarding both to the real ResponseWriter, so validation is transparent to
// the httptest.Server the tests already talk to over HTTP.
type specRecorder struct {
	http.ResponseWriter
	status      int
	wroteHeader bool
	body        *bytes.Buffer
}

func (r *specRecorder) WriteHeader(status int) {
	r.status = status
	r.wroteHeader = true
	r.ResponseWriter.WriteHeader(status)
}

func (r *specRecorder) Write(b []byte) (int, error) {
	if !r.wroteHeader {
		r.WriteHeader(http.StatusOK)
	}
	r.body.Write(b)
	return r.ResponseWriter.Write(b)
}
