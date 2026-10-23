# Testing Guide for Ally Learn Core

This document provides comprehensive guidance on running and writing tests for the Ally Learn Core application.

## Test Structure

```
tests/
├── __init__.py                     # Test package initialization
├── conftest.py                     # Shared fixtures and configuration
├── README.md                       # This file
├── fixtures/                       # Test data factories and fixtures
│   ├── __init__.py
│   └── scenario_fixtures.py        # Scenario-specific test fixtures
├── integration/                    # Integration tests
│   ├── __init__.py
│   └── test_metadata_integration.py # End-to-end metadata parsing tests
├── unit/                          # Unit tests
│   ├── __init__.py
│   ├── test_livekit_models.py     # Tests for LiveKit models
│   ├── test_metadata_parser.py    # Tests for metadata parser
│   └── test_scenario_models.py    # Tests for scenario models
└── utils/                         # Test utilities and helpers
    ├── __init__.py
    └── test_helpers.py            # Common test utilities
```

## Running Tests

### Prerequisites

1. **Install test dependencies:**
   ```bash
   poetry install --with test
   ```

2. **Set up environment variables:**
   ```bash
   cp env_sample .env
   # Edit .env with test-appropriate values
   ```

### Basic Test Commands

```bash
# Run all tests
poetry run pytest

# Run only unit tests
poetry run pytest tests/unit/ -m "unit"

# Run only integration tests
poetry run pytest tests/integration/ -m "integration"

# Run with coverage report
poetry run pytest --cov=app --cov-report=html

# Run specific test file
poetry run pytest tests/unit/test_metadata_parser.py

# Run specific test method
poetry run pytest tests/unit/test_metadata_parser.py::TestParseRoomMetadata::test_parse_valid_json_metadata

# Run tests in parallel (faster)
poetry run pytest -n auto

# Run tests with verbose output
poetry run pytest -v

# Run tests and stop on first failure
poetry run pytest -x
```

### Test Markers

Tests are organized using pytest markers:

- `@pytest.mark.unit` - Unit tests (fast, isolated)
- `@pytest.mark.integration` - Integration tests (slower, with dependencies)
- `@pytest.mark.slow` - Slow running tests
- `@pytest.mark.external` - Tests requiring external services
- `@pytest.mark.livekit` - LiveKit-specific tests
- `@pytest.mark.auth` - Authentication tests
- `@pytest.mark.database` - Database tests

```bash
# Run only fast unit tests
poetry run pytest -m "unit and not slow"

# Run all tests except external service tests
poetry run pytest -m "not external"

# Run only LiveKit related tests
poetry run pytest -m "livekit"
```

## Test Configuration

### pytest.ini

The `pytest.ini` file contains project-wide test configuration:

- **Test discovery**: Automatically finds test files matching `test_*.py` or `*_test.py`
- **Coverage settings**: Generates coverage reports with 80% minimum threshold
- **Async support**: Automatically handles async test functions
- **Markers**: Defines custom test markers for organization
- **Output formatting**: Configures verbose output and short tracebacks

### conftest.py

Contains shared fixtures and test configuration:

- **Sample data fixtures**: Pre-built test data for common scenarios
- **Mock fixtures**: Mock objects for external dependencies
- **Async fixtures**: Support for async test operations
- **Factory fixtures**: Flexible test data generation
- **Utility fixtures**: Helper functions for test assertions

## Writing Tests

### Test Organization

1. **Unit Tests** (`tests/unit/`):
   - Test individual functions/methods in isolation
   - Use mocks for external dependencies
   - Fast execution (< 1 second per test)
   - High coverage of edge cases

2. **Integration Tests** (`tests/integration/`):
   - Test component interactions
   - May use real dependencies (database, external APIs)
   - Slower execution but more realistic scenarios
   - Focus on end-to-end workflows

### Test Naming Conventions

```python
class TestClassName:
    """Test cases for ClassName."""

    def test_method_name_with_valid_input(self):
        """Test method_name with valid input."""
        pass

    def test_method_name_with_invalid_input(self):
        """Test method_name with invalid input."""
        pass

    def test_method_name_edge_case(self):
        """Test method_name edge case scenario."""
        pass
```

### Using Fixtures

```python
def test_parse_metadata_with_fixture(self, sample_room_metadata_json):
    """Test using pre-built fixture."""
    result = parse_room_metadata(sample_room_metadata_json)
    assert result is not None

def test_parse_metadata_with_factory(self, room_metadata_factory):
    """Test using factory fixture."""
    metadata = room_metadata_factory(version="2.0")
    json_data = json.dumps(metadata)
    result = parse_room_metadata(json_data)
    assert result.version == "2.0"
```

### Mocking External Dependencies

```python
@patch('app.utils.metadata_parser.logger')
def test_with_mocked_logger(self, mock_logger):
    """Test with mocked logger."""
    parse_room_metadata('invalid json')
    mock_logger.error.assert_called_once()

def test_with_fixture_mock(self, mock_logger):
    """Test using fixture-provided mock."""
    parse_room_metadata('invalid json')
    mock_logger.error.assert_called_once()
```

### Parametrized Tests

```python
@pytest.mark.parametrize("input_data,expected", [
    ('{"valid": "json"}', True),
    ('invalid json', False),
    ('', True),
])
def test_json_parsing_variations(self, input_data, expected):
    """Test multiple input variations."""
    # Test implementation
    pass
```

### Async Tests

```python
@pytest.mark.asyncio
async def test_async_function(self):
    """Test async functionality."""
    result = await some_async_function()
    assert result is not None
```

## Test Data Management

### Using Factories

The `tests/fixtures/scenario_fixtures.py` provides factory classes for creating test data:

```python
from tests.fixtures.scenario_fixtures import ScenarioFactory, create_scenario_payload

def test_with_factory():
    # Create a scenario with factory
    scenario = ScenarioFactory()

    # Create custom payload
    payload = create_scenario_payload(
        title="Custom Test",
        voice={"provider": "deepgram"}
    )
```

### Predefined Test Data

Use predefined test scenarios for common cases:

```python
from tests.fixtures.scenario_fixtures import MINIMAL_SCENARIO_PAYLOAD, COMPLEX_SCENARIO_PAYLOAD

def test_minimal_scenario():
    result = process_scenario(MINIMAL_SCENARIO_PAYLOAD)
    assert result is not None

def test_complex_scenario():
    result = process_scenario(COMPLEX_SCENARIO_PAYLOAD)
    assert result.metadata["complexity"] == "high"
```

## Best Practices

### Test Structure

1. **Arrange, Act, Assert (AAA)**:
   ```python
   def test_function():
       # Arrange
       input_data = create_test_data()

       # Act
       result = function_under_test(input_data)

       # Assert
       assert result.expected_property == expected_value
   ```

2. **One assertion per test** (when possible):
   ```python
   def test_function_returns_correct_type():
       result = function_under_test()
       assert isinstance(result, ExpectedType)

   def test_function_returns_correct_value():
       result = function_under_test()
       assert result.value == expected_value
   ```

### Error Testing

```python
def test_function_raises_exception_on_invalid_input():
    with pytest.raises(ValueError, match="Invalid input"):
        function_under_test("invalid")

def test_function_handles_exception_gracefully():
    with patch('external_dependency', side_effect=Exception("Test error")):
        result = function_under_test()
        assert result is not None  # Should handle gracefully
```

### Performance Testing

```python
def test_function_performance():
    import time

    start_time = time.time()
    result = function_under_test(large_input)
    end_time = time.time()

    assert end_time - start_time < 1.0  # Should complete within 1 second
    assert result is not None
```

### Thread Safety Testing

```python
def test_function_thread_safety():
    import threading

    results = []
    errors = []

    def worker():
        try:
            result = function_under_test()
            results.append(result)
        except Exception as e:
            errors.append(e)

    threads = [threading.Thread(target=worker) for _ in range(10)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert len(errors) == 0
    assert len(results) == 10
```

## Continuous Integration

Tests run automatically on:
- Push to `main` or `develop` branches
- Pull requests to `main` or `develop`

The CI pipeline includes:
1. **Unit tests** with coverage reporting
2. **Integration tests** with database setup
3. **Linting checks** (when configured)
4. **Security scans** (when configured)

### Coverage Requirements

- Minimum coverage: 80%
- Coverage reports generated in HTML and XML formats
- Coverage uploaded to Codecov (when configured)

## Debugging Tests

### Running Tests in Debug Mode

```bash
# Run with Python debugger
poetry run pytest --pdb

# Run with verbose output and no capture (see print statements)
poetry run pytest -v -s

# Run specific test with maximum verbosity
poetry run pytest tests/unit/test_metadata_parser.py::TestParseRoomMetadata::test_parse_valid_json_metadata -vvv
```

### Using Test Helpers

```python
from tests.utils.test_helpers import AssertionHelpers

def test_with_helpers():
    envelope = create_envelope()

    # Use helper assertions
    AssertionHelpers.assert_valid_room_metadata_envelope(envelope, "1.0")
    AssertionHelpers.assert_scenario_has_required_fields(envelope.scenario)
```

## Common Issues and Solutions

### Import Errors

If you encounter import errors:
```bash
# Ensure the app package is in Python path
export PYTHONPATH="${PYTHONPATH}:$(pwd)"

# Or install in development mode
poetry install -e .
```

### Async Test Issues

For async test problems:
```python
# Ensure proper async marking
@pytest.mark.asyncio
async def test_async_function():
    result = await async_function()
    assert result is not None
```

### Mock Issues

For mocking problems:
```python
# Use proper patch target (where it's imported, not where it's defined)
@patch('app.utils.metadata_parser.logger')  # Correct
# Not: @patch('app.core.logger.get_logger')  # Incorrect
```

### Database Test Issues

For database-related test issues:
```bash
# Ensure test database is set up
export DATABASE_URL="postgresql://test_user:test_password@localhost:5432/test_db"

# Run database migrations for tests
poetry run alembic upgrade head
```

## Contributing

When adding new tests:

1. **Follow naming conventions**
2. **Add appropriate markers**
3. **Include docstrings**
4. **Test both success and failure cases**
5. **Use existing fixtures when possible**
6. **Add new fixtures for reusable test data**
7. **Update this README if adding new test patterns**

For questions or issues with testing, please refer to the project documentation or create an issue in the repository.
