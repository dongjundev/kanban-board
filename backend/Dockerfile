# ---- 빌드 스테이지: gradle wrapper로 fat jar 생성 ----
FROM eclipse-temurin:21-jdk AS build
WORKDIR /app

# 의존성 레이어 캐시: 빌드 스크립트만 먼저 복사해 받아둔다(소스만 바뀌면 재다운로드 없음)
COPY gradlew ./
COPY gradle ./gradle
COPY settings.gradle build.gradle ./
RUN chmod +x gradlew && ./gradlew dependencies --no-daemon || true

# 소스 복사 후 실행 가능한 fat jar 빌드
COPY src ./src
RUN ./gradlew bootJar --no-daemon

# ---- 런타임 스테이지: JRE만 (빌드 도구 제외) ----
FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /app/build/libs/*.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
