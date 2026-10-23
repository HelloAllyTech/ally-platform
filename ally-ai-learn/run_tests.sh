#!/bin/bash

# Test runner script for Ally Learn Core
# This script provides convenient commands for running different types of tests

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check if poetry is installed
check_poetry() {
    if ! command -v poetry &> /dev/null; then
        print_error "Poetry is not installed. Please install Poetry first."
        exit 1
    fi
}

# Function to install dependencies
install_deps() {
    print_status "Installing test dependencies..."
    poetry install --with test
    print_success "Dependencies installed successfully"
}

# Function to run unit tests
run_unit_tests() {
    print_status "Running unit tests..."
    poetry run pytest tests/unit/ -v --tb=short -m "unit" --cov=app --cov-report=term-missing
}

# Function to run integration tests
run_integration_tests() {
    print_status "Running integration tests..."
    poetry run pytest tests/integration/ -v --tb=short -m "integration"
}

# Function to run all tests
run_all_tests() {
    print_status "Running all tests..."
    poetry run pytest -v --tb=short --cov=app --cov-report=html --cov-report=term-missing
}

# Function to run tests with coverage
run_tests_with_coverage() {
    print_status "Running tests with detailed coverage..."
    poetry run pytest --cov=app --cov-report=html --cov-report=xml --cov-report=term-missing --cov-fail-under=80
    print_success "Coverage report generated in htmlcov/ directory"
}

# Function to run specific test file
run_specific_test() {
    if [ -z "$1" ]; then
        print_error "Please provide a test file path"
        echo "Usage: $0 specific tests/unit/test_metadata_parser.py"
        exit 1
    fi

    print_status "Running specific test: $1"
    poetry run pytest "$1" -v --tb=short
}

# Function to run tests in parallel
run_parallel_tests() {
    print_status "Running tests in parallel..."
    poetry run pytest -n auto -v --tb=short --cov=app --cov-report=term-missing
}

# Function to run performance tests
run_performance_tests() {
    print_status "Running performance tests..."
    poetry run pytest -v --tb=short -m "not slow" --durations=10
}

# Function to run tests with specific marker
run_marked_tests() {
    if [ -z "$1" ]; then
        print_error "Please provide a test marker"
        echo "Usage: $0 marker livekit"
        echo "Available markers: unit, integration, slow, external, livekit, auth, database"
        exit 1
    fi

    print_status "Running tests with marker: $1"
    poetry run pytest -v --tb=short -m "$1"
}

# Function to run linting (if configured)
run_linting() {
    print_status "Running linting checks..."
    # Add linting commands here when configured
    print_warning "Linting tools not configured yet"
    # poetry run flake8 app/
    # poetry run black --check app/
    # poetry run isort --check-only app/
}

# Function to run security checks (if configured)
run_security_checks() {
    print_status "Running security checks..."
    # Add security scanning commands here when configured
    print_warning "Security scanning tools not configured yet"
    # poetry run bandit -r app/
    # poetry run safety check
}

# Function to clean test artifacts
clean_test_artifacts() {
    print_status "Cleaning test artifacts..."
    rm -rf htmlcov/
    rm -rf .coverage
    rm -rf coverage.xml
    rm -rf .pytest_cache/
    find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
    find . -type f -name "*.pyc" -delete 2>/dev/null || true
    print_success "Test artifacts cleaned"
}

# Function to show test statistics
show_test_stats() {
    print_status "Generating test statistics..."
    poetry run pytest --collect-only -q | grep -E "test session starts|collected"

    echo ""
    print_status "Test file breakdown:"
    find tests/ -name "test_*.py" -exec basename {} \; | sort

    echo ""
    print_status "Test markers usage:"
    poetry run pytest --markers | grep -E "^@pytest.mark"
}

# Function to run quick smoke tests
run_smoke_tests() {
    print_status "Running quick smoke tests..."
    poetry run pytest tests/unit/test_metadata_parser.py::TestParseRoomMetadata::test_parse_valid_json_metadata -v
    poetry run pytest tests/unit/test_livekit_models.py::TestRoomMetadataEnvelope::test_create_with_full_payload -v
    print_success "Smoke tests completed"
}

# Function to set up test environment
setup_test_env() {
    print_status "Setting up test environment..."

    # Check if .env exists
    if [ ! -f .env ]; then
        print_warning ".env file not found, copying from env_sample"
        cp env_sample .env
        print_warning "Please update .env with appropriate test values"
    fi

    # Install dependencies
    install_deps

    print_success "Test environment setup completed"
}

# Function to show help
show_help() {
    echo "Ally Learn Core Test Runner"
    echo ""
    echo "Usage: $0 [command] [options]"
    echo ""
    echo "Commands:"
    echo "  unit                    Run unit tests only"
    echo "  integration            Run integration tests only"
    echo "  all                    Run all tests"
    echo "  coverage               Run tests with detailed coverage report"
    echo "  specific <file>        Run specific test file"
    echo "  parallel               Run tests in parallel"
    echo "  performance            Run performance tests (exclude slow tests)"
    echo "  marker <marker>        Run tests with specific marker"
    echo "  smoke                  Run quick smoke tests"
    echo "  lint                   Run linting checks"
    echo "  security               Run security checks"
    echo "  stats                  Show test statistics"
    echo "  clean                  Clean test artifacts"
    echo "  setup                  Set up test environment"
    echo "  install                Install test dependencies"
    echo "  help                   Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 unit                                    # Run unit tests"
    echo "  $0 specific tests/unit/test_metadata_parser.py  # Run specific test"
    echo "  $0 marker livekit                         # Run LiveKit tests"
    echo "  $0 coverage                               # Run with coverage"
    echo ""
    echo "Test Markers:"
    echo "  unit, integration, slow, external, livekit, auth, database"
}

# Main script logic
main() {
    # Check if poetry is available
    check_poetry

    # Parse command line arguments
    case "${1:-help}" in
        "unit")
            run_unit_tests
            ;;
        "integration")
            run_integration_tests
            ;;
        "all")
            run_all_tests
            ;;
        "coverage")
            run_tests_with_coverage
            ;;
        "specific")
            run_specific_test "$2"
            ;;
        "parallel")
            run_parallel_tests
            ;;
        "performance")
            run_performance_tests
            ;;
        "marker")
            run_marked_tests "$2"
            ;;
        "smoke")
            run_smoke_tests
            ;;
        "lint")
            run_linting
            ;;
        "security")
            run_security_checks
            ;;
        "stats")
            show_test_stats
            ;;
        "clean")
            clean_test_artifacts
            ;;
        "setup")
            setup_test_env
            ;;
        "install")
            install_deps
            ;;
        "help"|*)
            show_help
            ;;
    esac
}

# Run main function with all arguments
main "$@"
