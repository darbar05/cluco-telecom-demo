from setuptools import setup, find_packages

setup(
    name="cluco-obs",
    version="0.1.0",
    packages=find_packages(),
    python_requires=">=3.10",
    description="Cluco Observability SDK — product-agnostic tracing for AI agents",
    install_requires=[],
    extras_require={
        "langchain": ["langchain-core>=0.1.0"],
    },
)
