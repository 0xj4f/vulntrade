# VULN: Runs as root, debug port exposed, JMX exposed
FROM maven:3.8.6-eclipse-temurin-11 AS build

# VULN: Running as root (no USER directive)
WORKDIR /app

# Copy pom first for dependency caching
COPY pom.xml .
RUN mvn dependency:go-offline -B 2>/dev/null || true

# Copy source and build
COPY src ./src
RUN mvn package -DskipTests -B

# Runtime stage - still vulnerable
# VULN: Using JDK 11.0.11 — trustURLCodebase flag works, enabling Log4Shell remote class loading.
# Later JDK builds (11.0.16+) added ObjectFactoryBuilder restrictions that silently ignore the flag.
# 11.0.11 is the sweet spot: modern enough for Spring Boot, old enough for Log4Shell RCE.
FROM adoptopenjdk:11.0.11_9-jre-hotspot

WORKDIR /app
COPY --from=build /app/target/*.jar app.jar

# Create log directory for structured SIEM logging
RUN mkdir -p /var/log/vulntrade && chmod 777 /var/log/vulntrade

# VULN: Debug port 5005 exposed
# VULN: JMX port 9090 exposed without authentication
EXPOSE 8080 5005 9090

# VULN: Running with debug and JMX enabled
# VULN: JNDI trust flags enable Log4Shell remote class loading (CVE-2021-44228)
ENV JAVA_OPTS="-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=*:5005 \
    -Dcom.sun.management.jmxremote \
    -Dcom.sun.management.jmxremote.port=9090 \
    -Dcom.sun.management.jmxremote.rmi.port=9090 \
    -Dcom.sun.management.jmxremote.authenticate=false \
    -Dcom.sun.management.jmxremote.ssl=false \
    -Djava.rmi.server.hostname=0.0.0.0 \
    -Dcom.sun.jndi.ldap.object.trustURLCodebase=true \
    -Dcom.sun.jndi.rmi.object.trustURLCodebase=true"

ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]
